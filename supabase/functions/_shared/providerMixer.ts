/**
 * Provider Mixer - UNIFIED mixing engine for all catalog feeds
 * 
 * CRITICAL: This is the SINGLE source of truth for mixing Amazon + eBay results.
 * All catalog endpoints (search, category, home) MUST use this mixer.
 * 
 * Mixing Strategy (Admin-Configurable):
 * 1. AMAZON_FIRST PHASE: Return first N items from Amazon (N = mixedAmazonFirstCount)
 * 2. BLEND PHASE: Interleave by ratio (e.g., 1:2 = 1 Amazon, 2 eBay per cycle)
 * 3. EBAY_ONLY PHASE: When Amazon cap/budget exhausted, continue with eBay
 * 
 * Cursor-based pagination preserves mixer state across pages.
 */

import { BlendRatio } from "./catalogSettings.ts";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface ProviderItem {
  id: string;
  provider: string;
  providerProductId: string;
  [key: string]: unknown;
}

export type MixingPhase = "amazon_first" | "blend" | "ebay_only";

export interface MixerCursor {
  // Provider offsets
  ebayOffset: number;
  amazonPage: number;
  
  // Mixer state (preserved across pages)
  amazonReturnedSoFar: number;
  ebayReturnedSoFar: number;
  mixingPhase: MixingPhase;
  totalReturned: number;
  
  // Blend phase state
  blendCyclePosition: number;  // Position within current A:B cycle
  
  // Exhaustion flags
  amazonExhausted: boolean;
  ebayExhausted: boolean;
}

export interface MixerResult {
  items: ProviderItem[];
  nextCursor: MixerCursor | null;
  hasMore: boolean;
  amazonReturned: number;
  ebayReturned: number;
  mixingPhase: MixingPhase;
  debugLog: string[];  // Debug info for logging
}

// ─── CURSOR ENCODING ──────────────────────────────────────────────────────────

export function encodeMixerCursor(cursor: MixerCursor): string {
  return btoa(JSON.stringify(cursor));
}

export function decodeMixerCursor(encoded: string): MixerCursor | null {
  try {
    const decoded = atob(encoded);
    const data = JSON.parse(decoded);
    // Validate required fields
    if (typeof data.ebayOffset === "number" && typeof data.amazonReturnedSoFar === "number") {
      // Migrate old cursors without new fields
      return {
        ebayOffset: data.ebayOffset,
        amazonPage: data.amazonPage || 1,
        amazonReturnedSoFar: data.amazonReturnedSoFar,
        ebayReturnedSoFar: data.ebayReturnedSoFar || 0,
        mixingPhase: data.mixingPhase || "amazon_first",
        totalReturned: data.totalReturned || 0,
        blendCyclePosition: data.blendCyclePosition || 0,
        amazonExhausted: data.amazonExhausted || false,
        ebayExhausted: data.ebayExhausted || false,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function getInitialCursor(): MixerCursor {
  return {
    ebayOffset: 0,
    amazonPage: 1,
    amazonReturnedSoFar: 0,
    ebayReturnedSoFar: 0,
    mixingPhase: "amazon_first",
    totalReturned: 0,
    blendCyclePosition: 0,
    amazonExhausted: false,
    ebayExhausted: false,
  };
}

// ─── DEDUPLICATION ────────────────────────────────────────────────────────────

function getItemKey(item: ProviderItem): string {
  return `${item.provider}:${item.providerProductId}`;
}

export function deduplicateItems(items: ProviderItem[]): ProviderItem[] {
  const seen = new Set<string>();
  const result: ProviderItem[] = [];

  for (const item of items) {
    const key = getItemKey(item);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }

  return result;
}

// ─── MIXING LOGIC ─────────────────────────────────────────────────────────────

export interface MixParams {
  amazonItems: ProviderItem[];
  ebayItems: ProviderItem[];
  limit: number;
  cursor: MixerCursor;
  amazonFirstCount: number;
  blendRatio: BlendRatio;
  amazonCap: number;
  amazonHasMore: boolean;
  ebayHasMore: boolean;
  categoryKey?: string;  // For logging
  requestId?: string;    // For logging
}

/**
 * Mix Amazon and eBay items according to admin-configured strategy
 * 
 * PHASES:
 * 1. amazon_first: Amazon items exclusively until amazonFirstCount is met
 * 2. blend: Interleave by blendRatio (e.g., 1:2 = 1 Amazon, 2 eBay per cycle)
 * 3. ebay_only: eBay only (when Amazon exhausted or cap hit)
 * 
 * INVARIANTS:
 * - Amazon-first items are ALWAYS output first when Amazon has items
 * - Blend ratio is respected exactly (not approximated)
 * - Cursor preserves ALL mixer state for consistent pagination
 */
export function mixProviderItems(params: MixParams): MixerResult {
  const {
    amazonItems,
    ebayItems,
    limit,
    cursor,
    amazonFirstCount,
    blendRatio,
    amazonCap,
    amazonHasMore,
    ebayHasMore,
    categoryKey,
    requestId,
  } = params;

  const debugLog: string[] = [];
  let mixingPhase = cursor.mixingPhase;
  let amazonIndex = 0;
  let ebayIndex = 0;
  const result: ProviderItem[] = [];
  
  // Track cumulative returns
  let amazonReturned = cursor.amazonReturnedSoFar;
  let ebayReturned = cursor.ebayReturnedSoFar;
  let blendCyclePosition = cursor.blendCyclePosition;
  
  // Track exhaustion (from cursor or live data)
  let amazonExhausted = cursor.amazonExhausted || (!amazonHasMore && amazonItems.length === 0);
  let ebayExhausted = cursor.ebayExhausted || (!ebayHasMore && ebayItems.length === 0);
  
  // Check if Amazon cap hit
  const amazonCapHit = amazonReturned >= amazonCap;
  
  // Force ebay_only if Amazon is unavailable
  if (amazonExhausted || amazonCapHit) {
    if (mixingPhase !== "ebay_only") {
      debugLog.push(`[MIX] Transitioning to ebay_only: exhausted=${amazonExhausted} capHit=${amazonCapHit}`);
    }
    mixingPhase = "ebay_only";
  }

  debugLog.push(`[MIX] category=${categoryKey || "search"} N=${amazonFirstCount} ratio=${blendRatio.amazon}:${blendRatio.ebay} phase=${mixingPhase}`);
  debugLog.push(`[MIX] amazonAvailable=${amazonItems.length} ebayAvailable=${ebayItems.length} amazonReturnedSoFar=${amazonReturned} cap=${amazonCap}`);

  // Track providers of returned items for debug
  const returnedProviders: string[] = [];

  while (result.length < limit) {
    const hasAmazon = amazonIndex < amazonItems.length;
    const hasEbay = ebayIndex < ebayItems.length;

    if (!hasAmazon && !hasEbay) {
      debugLog.push(`[MIX] Both providers exhausted at position ${result.length}`);
      break;
    }

    switch (mixingPhase) {
      case "amazon_first": {
        // PHASE 1: Amazon-dominant until amazonFirstCount satisfied
        // RULE: If Amazon has items and we haven't hit N yet, output Amazon
        if (hasAmazon && amazonReturned < amazonFirstCount && amazonReturned < amazonCap) {
          result.push(amazonItems[amazonIndex]);
          returnedProviders.push("A");
          amazonIndex++;
          amazonReturned++;
        } else if (hasEbay) {
          // Amazon exhausted or N reached, use eBay while in amazon_first
          result.push(ebayItems[ebayIndex]);
          returnedProviders.push("E");
          ebayIndex++;
          ebayReturned++;
        } else if (hasAmazon && amazonReturned < amazonCap) {
          // No eBay, continue with Amazon
          result.push(amazonItems[amazonIndex]);
          returnedProviders.push("A");
          amazonIndex++;
          amazonReturned++;
        }

        // Transition to blend phase after N items from Amazon
        if (amazonReturned >= amazonFirstCount) {
          mixingPhase = "blend";
          blendCyclePosition = 0; // Reset cycle for blend phase
          debugLog.push(`[MIX] Transitioning to blend phase at amazonReturned=${amazonReturned}`);
        }
        break;
      }

      case "blend": {
        // PHASE 2: Interleave by ratio
        const cycleSize = blendRatio.amazon + blendRatio.ebay;
        
        // First `amazon` items in cycle are Amazon, rest are eBay
        const useAmazon = blendCyclePosition < blendRatio.amazon;
        
        if (useAmazon && hasAmazon && amazonReturned < amazonCap) {
          result.push(amazonItems[amazonIndex]);
          returnedProviders.push("A");
          amazonIndex++;
          amazonReturned++;
          blendCyclePosition = (blendCyclePosition + 1) % cycleSize;
        } else if (!useAmazon && hasEbay) {
          result.push(ebayItems[ebayIndex]);
          returnedProviders.push("E");
          ebayIndex++;
          ebayReturned++;
          blendCyclePosition = (blendCyclePosition + 1) % cycleSize;
        } else if (hasEbay) {
          // Amazon's turn but no Amazon available - use eBay, advance cycle
          result.push(ebayItems[ebayIndex]);
          returnedProviders.push("E");
          ebayIndex++;
          ebayReturned++;
          blendCyclePosition = (blendCyclePosition + 1) % cycleSize;
        } else if (hasAmazon && amazonReturned < amazonCap) {
          // eBay's turn but no eBay - use Amazon
          result.push(amazonItems[amazonIndex]);
          returnedProviders.push("A");
          amazonIndex++;
          amazonReturned++;
          blendCyclePosition = (blendCyclePosition + 1) % cycleSize;
        }

        // Transition to eBay-only if Amazon exhausted
        if (amazonReturned >= amazonCap || (amazonIndex >= amazonItems.length && !amazonHasMore)) {
          mixingPhase = "ebay_only";
          amazonExhausted = true;
          debugLog.push(`[MIX] Transitioning to ebay_only at amazonReturned=${amazonReturned}`);
        }
        break;
      }

      case "ebay_only": {
        // PHASE 3: eBay only
        if (hasEbay) {
          result.push(ebayItems[ebayIndex]);
          returnedProviders.push("E");
          ebayIndex++;
          ebayReturned++;
        } else {
          break;
        }
        break;
      }
    }
  }

  // Log first 20 provider sequence
  const first20 = returnedProviders.slice(0, 20).join(",");
  debugLog.push(`[MIX] first20 providers=[${first20}]`);
  debugLog.push(`[MIX] returned: amazon=${amazonReturned - cursor.amazonReturnedSoFar} ebay=${ebayReturned - cursor.ebayReturnedSoFar} total=${result.length}`);

  // Deduplicate
  const dedupedItems = deduplicateItems(result);

  // Update exhaustion flags based on current data
  if (amazonIndex >= amazonItems.length && !amazonHasMore) {
    amazonExhausted = true;
  }
  if (ebayIndex >= ebayItems.length && !ebayHasMore) {
    ebayExhausted = true;
  }

  // Determine if there's more
  const hasMore = 
    (!ebayExhausted) || 
    (!amazonExhausted && amazonReturned < amazonCap) ||
    (ebayIndex < ebayItems.length) ||
    (amazonIndex < amazonItems.length && amazonReturned < amazonCap);

  // Build next cursor with full mixer state
  const nextCursor: MixerCursor | null = hasMore ? {
    ebayOffset: cursor.ebayOffset + ebayIndex,
    amazonPage: cursor.amazonPage + (amazonIndex > 0 ? 1 : 0),
    amazonReturnedSoFar: amazonReturned,
    ebayReturnedSoFar: ebayReturned,
    mixingPhase,
    totalReturned: cursor.totalReturned + dedupedItems.length,
    blendCyclePosition,
    amazonExhausted,
    ebayExhausted,
  } : null;

  return {
    items: dedupedItems,
    nextCursor,
    hasMore,
    amazonReturned,
    ebayReturned,
    mixingPhase,
    debugLog,
  };
}

// ─── DEBUG LOGGING ────────────────────────────────────────────────────────────

/**
 * Log mixer debug info (call in endpoints for dev debugging)
 */
export function logMixerDebug(
  result: MixerResult,
  requestId: string,
  categoryKey?: string
): void {
  const prefix = categoryKey ? `[MIX:${categoryKey}]` : "[MIX:search]";
  for (const line of result.debugLog) {
    console.log(`${prefix} requestId=${requestId} ${line.replace("[MIX] ", "")}`);
  }
}

// ─── PROVIDER STATS ───────────────────────────────────────────────────────────

export interface ProviderStats {
  mode: string;
  amazonEnabled: boolean;
  ebayEnabled: boolean;
  amazonCacheHit: boolean;
  amazonBudgetRemaining: number | null;
  amazonReturned: number;
  amazonCap: number;
  amazonStatus: string;
  ebayReturned: number;
  mixingPhase?: string;  // Added for transparency
  amazonFirstCount?: number;  // Show configured N
  blendRatio?: { amazon: number; ebay: number };  // Show configured ratio
}

export function buildProviderStats(params: {
  mode: string;
  amazonEnabled: boolean;
  ebayEnabled: boolean;
  amazonCacheHit: boolean;
  amazonBudgetRemaining: number | null;
  amazonReturned: number;
  amazonCap: number;
  amazonStatus: string;
  ebayReturned: number;
  mixingPhase?: string;
  amazonFirstCount?: number;
  blendRatio?: { amazon: number; ebay: number };
}): ProviderStats {
  return {
    mode: params.mode,
    amazonEnabled: params.amazonEnabled,
    ebayEnabled: params.ebayEnabled,
    amazonCacheHit: params.amazonCacheHit,
    amazonBudgetRemaining: params.amazonBudgetRemaining,
    amazonReturned: params.amazonReturned,
    amazonCap: params.amazonCap,
    amazonStatus: params.amazonStatus,
    ebayReturned: params.ebayReturned,
    mixingPhase: params.mixingPhase,
    amazonFirstCount: params.amazonFirstCount,
    blendRatio: params.blendRatio,
  };
}
