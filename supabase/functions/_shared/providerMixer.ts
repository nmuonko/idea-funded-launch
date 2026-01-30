/**
 * Provider Mixer
 * Handles merging of Amazon and eBay results with configurable ordering
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
  ebayOffset: number;
  amazonPage: number;
  amazonReturnedSoFar: number;
  mixingPhase: MixingPhase;
  totalReturned: number;
}

export interface MixerResult {
  items: ProviderItem[];
  nextCursor: MixerCursor | null;
  hasMore: boolean;
  amazonReturned: number;
  ebayReturned: number;
  mixingPhase: MixingPhase;
}

// ─── CURSOR ENCODING ──────────────────────────────────────────────────────────

export function encodeMixerCursor(cursor: MixerCursor): string {
  return btoa(JSON.stringify(cursor));
}

export function decodeMixerCursor(encoded: string): MixerCursor | null {
  try {
    const decoded = atob(encoded);
    const data = JSON.parse(decoded);
    if (typeof data.ebayOffset === "number" && typeof data.amazonPage === "number") {
      return data as MixerCursor;
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
    mixingPhase: "amazon_first",
    totalReturned: 0,
  };
}

// ─── DEDUPLICATION ────────────────────────────────────────────────────────────

/**
 * Create unique key for deduplication
 */
function getItemKey(item: ProviderItem): string {
  return `${item.provider}:${item.providerProductId}`;
}

/**
 * Remove duplicates from merged items
 */
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
}

/**
 * Mix Amazon and eBay items according to configured strategy
 * 
 * Strategy:
 * 1. Amazon-first phase: Return amazonFirstCount items from Amazon
 * 2. Blend phase: Interleave by blendRatio (e.g., 1:2 = 1 Amazon, 2 eBay)
 * 3. eBay-only phase: When Amazon exhausted or cap hit
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
  } = params;

  let mixingPhase = cursor.mixingPhase;
  let amazonIndex = 0;
  let ebayIndex = 0;
  const result: ProviderItem[] = [];
  let amazonReturned = cursor.amazonReturnedSoFar;
  let ebayReturned = 0;

  // Check if Amazon is exhausted
  const amazonExhausted = !amazonHasMore && amazonItems.length === 0;
  const amazonCapHit = amazonReturned >= amazonCap;

  if (amazonExhausted || amazonCapHit) {
    mixingPhase = "ebay_only";
  }

  while (result.length < limit) {
    const hasAmazon = amazonIndex < amazonItems.length;
    const hasEbay = ebayIndex < ebayItems.length;

    if (!hasAmazon && !hasEbay) break;

    switch (mixingPhase) {
      case "amazon_first": {
        // Phase 1: Amazon-dominant
        if (hasAmazon && amazonReturned < amazonFirstCount && amazonReturned < amazonCap) {
          result.push(amazonItems[amazonIndex]);
          amazonIndex++;
          amazonReturned++;
        } else if (hasEbay) {
          result.push(ebayItems[ebayIndex]);
          ebayIndex++;
          ebayReturned++;
        } else if (hasAmazon && amazonReturned < amazonCap) {
          result.push(amazonItems[amazonIndex]);
          amazonIndex++;
          amazonReturned++;
        }

        // Transition to blend phase
        if (amazonReturned >= amazonFirstCount) {
          mixingPhase = "blend";
        }
        break;
      }

      case "blend": {
        // Phase 2: Interleave by ratio
        const amazonRatio = blendRatio.amazon;
        const ebayRatio = blendRatio.ebay;
        const cycleSize = amazonRatio + ebayRatio;
        const cyclePosition = cursor.totalReturned + result.length;
        const positionInCycle = cyclePosition % cycleSize;

        // First amazonRatio items are Amazon, rest are eBay
        if (positionInCycle < amazonRatio && hasAmazon && amazonReturned < amazonCap) {
          result.push(amazonItems[amazonIndex]);
          amazonIndex++;
          amazonReturned++;
        } else if (hasEbay) {
          result.push(ebayItems[ebayIndex]);
          ebayIndex++;
          ebayReturned++;
        } else if (hasAmazon && amazonReturned < amazonCap) {
          result.push(amazonItems[amazonIndex]);
          amazonIndex++;
          amazonReturned++;
        }

        // Transition to eBay-only if Amazon exhausted
        if (amazonReturned >= amazonCap || (!amazonHasMore && amazonIndex >= amazonItems.length)) {
          mixingPhase = "ebay_only";
        }
        break;
      }

      case "ebay_only": {
        // Phase 3: eBay only
        if (hasEbay) {
          result.push(ebayItems[ebayIndex]);
          ebayIndex++;
          ebayReturned++;
        } else {
          break;
        }
        break;
      }
    }
  }

  // Deduplicate
  const dedupedItems = deduplicateItems(result);

  // Determine if there's more
  const hasMore = ebayHasMore || 
    (amazonHasMore && amazonReturned < amazonCap) ||
    ebayIndex < ebayItems.length ||
    amazonIndex < amazonItems.length;

  // Build next cursor
  const nextCursor: MixerCursor | null = hasMore ? {
    ebayOffset: cursor.ebayOffset + ebayIndex,
    amazonPage: cursor.amazonPage + (amazonIndex > 0 ? 1 : 0),
    amazonReturnedSoFar: amazonReturned,
    mixingPhase,
    totalReturned: cursor.totalReturned + dedupedItems.length,
  } : null;

  return {
    items: dedupedItems,
    nextCursor,
    hasMore,
    amazonReturned,
    ebayReturned,
    mixingPhase,
  };
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
  };
}
