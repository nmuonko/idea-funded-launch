/**
 * DB-First Search — queries catalog_items before hitting live providers.
 * Returns results instantly when DB has data, even if APIs are down.
 * 
 * TIERED SEARCH:
 *   Tier A: Token ilike match (fast, indexed)
 *   Tier B: pg_trgm fuzzy similarity (typo-tolerant)
 *   Tier C: Query expansion (strip year, add synonyms, nearby years)
 * 
 * Uses TTL policy for dynamic thresholds and freshness filtering.
 */

type SupabaseClientAny = any;

import { filterDisallowedItems } from "./contentBlocker.ts";
import { getTtlPolicy, TtlPolicy } from "./ttlPolicy.ts";
import { isValidProductImageUrl, upgradeToHighRes } from "./imageValidator.ts";

/**
 * Ensure provider diversity in results — inject minority-provider items
 * into the top results so users see items from SHEIN, Carvana, etc.
 */
function diversifyByProvider(items: Record<string, unknown>[], targetLimit: number): Record<string, unknown>[] {
  if (items.length <= 10) return items;

  // Group by provider
  const byProvider = new Map<string, Record<string, unknown>[]>();
  for (const item of items) {
    const p = (item.provider as string) || "unknown";
    if (!byProvider.has(p)) byProvider.set(p, []);
    byProvider.get(p)!.push(item);
  }

  // If only 1 provider, no diversity needed
  if (byProvider.size <= 1) return items;

  // Identify minority providers (< 10% of results)
  const total = items.length;
  const minorityItems: Record<string, unknown>[] = [];
  const majorityProviders = new Set<string>();
  for (const [provider, providerItems] of byProvider) {
    if (providerItems.length / total < 0.1) {
      // Take up to 6 items from each minority provider
      minorityItems.push(...providerItems.slice(0, 6));
    } else {
      majorityProviders.add(provider);
    }
  }

  if (minorityItems.length === 0) return items;

  // Interleave: place minority items at positions 3, 7, 11, 15... among majority results
  const majorityItems = items.filter(i => majorityProviders.has((i.provider as string) || ""));
  const result: Record<string, unknown>[] = [];
  const usedIds = new Set<string>();
  let mIdx = 0;
  let minIdx = 0;

  for (let pos = 0; result.length < targetLimit && (mIdx < majorityItems.length || minIdx < minorityItems.length); pos++) {
    // Every 4th position (starting at 3), insert a minority item
    if ((pos + 1) % 4 === 0 && minIdx < minorityItems.length) {
      const item = minorityItems[minIdx++];
      const id = item.id as string;
      if (!usedIds.has(id)) {
        usedIds.add(id);
        result.push(item);
      }
    } else if (mIdx < majorityItems.length) {
      const item = majorityItems[mIdx++];
      const id = item.id as string;
      if (!usedIds.has(id)) {
        usedIds.add(id);
        result.push(item);
      }
    }
  }

  // Append any remaining minority items at the end
  for (; minIdx < minorityItems.length && result.length < targetLimit; minIdx++) {
    const item = minorityItems[minIdx];
    if (!usedIds.has(item.id as string)) {
      result.push(item);
    }
  }

  return result;
}

export interface DbFirstParams {
  supabase: SupabaseClientAny;
  qNorm: string;
  aiExpandedTerms: string[] | null;
  limit: number;
  offset?: number;
  categoryKey: string | null;
  requestId: string;
}

export interface DbFirstResult {
  /** Mapped items ready for response (>= dbMinResults) */
  items: any[] | null;
  /** Partial fallback items (1..dbMinResults-1) */
  fallbackItems: any[] | null;
  dbCount: number;
  durationMs: number;
  /** Which tier produced the results */
  tier: "A" | "B" | "C" | "none";
  fuzzyUsed: boolean;
  expansionUsed: boolean;
}

// ─── FR/EN SYNONYMS for Tier C expansion ────────────────────────────────────
const EXPANSION_SYNONYMS: Record<string, string[]> = {
  "earbuds": ["écouteurs", "wireless earbuds", "earphones"],
  "écouteurs": ["earbuds", "wireless earbuds"],
  "headphones": ["casque", "casque audio", "headphone"],
  "casque": ["headphones", "headphone"],
  "phone": ["téléphone", "smartphone"],
  "téléphone": ["phone", "smartphone"],
  "watch": ["montre", "smartwatch"],
  "montre": ["watch", "smartwatch"],
  "shoes": ["chaussures", "sneakers", "baskets"],
  "chaussures": ["shoes", "sneakers"],
  "refrigerator": ["frigo", "fridge", "réfrigérateur"],
  "frigo": ["refrigerator", "fridge"],
  "laptop": ["ordinateur portable", "notebook"],
  "speaker": ["enceinte", "haut-parleur"],
  "tv": ["television", "smart tv", "télévision"],
  "tablet": ["tablette", "ipad"],
  "camera": ["appareil photo", "caméra"],
  "dress": ["robe"],
  "robe": ["dress", "maxi dress"],
  "jacket": ["veste", "manteau"],
  "pants": ["pantalon", "trousers"],
};

function mapDbItem(item: Record<string, unknown>, categoryKey: string | null): Record<string, unknown> | null {
  const rawImage = item.image_url as string | null;
  const imageUrl = rawImage && isValidProductImageUrl(rawImage) ? rawImage : null;
  if (!imageUrl) return null; // Skip items with banner/ad images
  return {
    id: item.external_id || item.id,
    title: item.title,
    priceUsd: item.price_usd,
    price_usd: item.price_usd,
    currency: item.currency || "USD",
    imageUrl,
    image_url: imageUrl,
    productUrl: item.product_url,
    product_url: item.product_url,
    provider: item.provider,
    rating: item.rating,
    imageCount: (item.image_count as number) || 1,
    category: item.unified_category || categoryKey,
    store: item.provider || "amazon",
  };
}

export async function searchDbFirst(params: DbFirstParams): Promise<DbFirstResult> {
  const { supabase, qNorm, aiExpandedTerms, limit, offset = 0, categoryKey, requestId } = params;
  const dbStartMs = Date.now();

  // Resolve TTL policy (global or per-category)
  let policy: TtlPolicy;
  try {
    policy = await getTtlPolicy(supabase, categoryKey);
  } catch {
    policy = { maxItemAgeDays: 30, priceRefreshDays: 3, availabilityRefreshDays: 3, dbMinResults: 5, enabled: true };
  }

  const DB_MIN_RESULTS = policy.dbMinResults;
  const TARGET_RESULTS = 800; // Target for expansion tiers — pull broadly from 700K+ cached catalog

  // Build tokens from primary query — use top 2 longest tokens first,
  // then fall back to single longest token if 2-token search returns too few
  const searchTokens = qNorm.split(/\s+/).filter((t: string) => t.length >= 2);
  const topTokens = [...searchTokens].sort((a: string, b: string) => b.length - a.length).slice(0, 2);

  if (topTokens.length === 0) {
    return { items: null, fallbackItems: null, dbCount: 0, durationMs: Date.now() - dbStartMs, tier: "none", fuzzyUsed: false, expansionUsed: false };
  }

  // ─── TIER A: Token ilike match (fast, indexed) ─────────────────────────────
  // First try with top 2 tokens (more precise)
  let tierAItems = await tierASearch(supabase, topTokens, categoryKey, 1000, requestId, offset);
  
  // If 2-token search returned few results, retry with just the single longest token for broader coverage
  if (tierAItems.length < 50 && topTokens.length >= 2) {
    const singleToken = [topTokens[0]]; // longest token only
    const broaderItems = await tierASearch(supabase, singleToken, categoryKey, 1000, requestId, offset);
    if (broaderItems.length > tierAItems.length) {
      // Merge: precise results first, then broader results
      const seenIds = new Set(tierAItems.map((i: any) => i.id));
      const newBroader = broaderItems.filter((i: any) => !seenIds.has(i.id));
      tierAItems = [...tierAItems, ...newBroader].slice(0, 1000);
    }
  }
  
  const tierACount = tierAItems.length;
  console.log(`[CATALOG_SEARCH] requestId=${requestId} db_tier_A q="${qNorm}" tokens=${JSON.stringify(topTokens)} count=${tierACount} minRequired=${DB_MIN_RESULTS}`);

  if (tierACount >= DB_MIN_RESULTS) {
    const mapped = tierAItems.map((item: Record<string, unknown>) => mapDbItem(item, categoryKey)).filter(Boolean) as Record<string, unknown>[];
    const diversified = diversifyByProvider(mapped, Math.max(limit, 500));
    const { allowed } = filterDisallowedItems(
      diversified.map((item: any) => ({ ...item, title: item.title, productUrl: item.productUrl, category: item.category })),
      `[DB_TIER_A] requestId=${requestId}`
    );
    return { items: allowed, fallbackItems: null, dbCount: tierACount, durationMs: Date.now() - dbStartMs, tier: "A", fuzzyUsed: false, expansionUsed: false };
  }

  // ─── TIER B: Fuzzy pg_trgm similarity (typo-tolerant) ─────────────────────
  const elapsed = Date.now() - dbStartMs;
  if (elapsed < 800) { // Generous time budget for fuzzy search
    const tierBItems = await tierBFuzzySearch(supabase, qNorm, categoryKey, limit, requestId);
    // Merge and dedupe with Tier A
    const seenIds = new Set(tierAItems.map((i: any) => i.id));
    const newBItems = tierBItems.filter((i: any) => !seenIds.has(i.id));
    const mergedAB = [...tierAItems, ...newBItems];
    const mergedCount = mergedAB.length;
    console.log(`[CATALOG_SEARCH] requestId=${requestId} db_tier_B fuzzy q="${qNorm}" new=${newBItems.length} merged=${mergedCount}`);

    if (mergedCount >= DB_MIN_RESULTS) {
      const mapped = mergedAB.map((item: Record<string, unknown>) => mapDbItem(item, categoryKey)).filter(Boolean);
      const { allowed } = filterDisallowedItems(
        mapped.map((item: any) => ({ ...item, title: item.title, productUrl: item.productUrl, category: item.category })),
        `[DB_TIER_B] requestId=${requestId}`
      );
      return { items: allowed, fallbackItems: null, dbCount: mergedCount, durationMs: Date.now() - dbStartMs, tier: "B", fuzzyUsed: true, expansionUsed: false };
    }

    // ─── TIER C: Query expansion ──────────────────────────────────────────────
    const elapsed2 = Date.now() - dbStartMs;
    if (elapsed2 < 1000 && mergedCount < TARGET_RESULTS) {
      const expansionQueries = generateExpansionQueries(qNorm);
      let pool = [...mergedAB];
      const poolIds = new Set(pool.map((i: any) => i.id));

      for (const eq of expansionQueries) {
        if (pool.length >= TARGET_RESULTS) break;
        if (Date.now() - dbStartMs > 1200) break;

        const eqTokens = eq.split(/\s+/).filter((t: string) => t.length >= 2);
        const eqTop = [...eqTokens].sort((a: string, b: string) => b.length - a.length).slice(0, 3);
        if (eqTop.length === 0) continue;

        const exItems = await tierASearch(supabase, eqTop, categoryKey, 200, requestId);
        const newItems = exItems.filter((i: any) => !poolIds.has(i.id));
        newItems.forEach((i: any) => poolIds.add(i.id));
        pool = [...pool, ...newItems];
      }

      const expansionCount = pool.length - mergedCount;
      console.log(`[CATALOG_SEARCH] requestId=${requestId} db_tier_C expansion queries=${expansionQueries.length} new=${expansionCount} total=${pool.length}`);

      if (pool.length >= DB_MIN_RESULTS) {
        const mapped = pool.map((item: Record<string, unknown>) => mapDbItem(item, categoryKey)).filter(Boolean);
        const { allowed } = filterDisallowedItems(
          mapped.map((item: any) => ({ ...item, title: item.title, productUrl: item.productUrl, category: item.category })),
          `[DB_TIER_C] requestId=${requestId}`
        );
        return { items: allowed, fallbackItems: null, dbCount: pool.length, durationMs: Date.now() - dbStartMs, tier: "C", fuzzyUsed: true, expansionUsed: true };
      }

      // Return whatever we have as fallback
      if (pool.length > 0) {
        const mapped = pool.map((item: Record<string, unknown>) => mapDbItem(item, categoryKey)).filter(Boolean);
        return { items: null, fallbackItems: mapped, dbCount: pool.length, durationMs: Date.now() - dbStartMs, tier: "C", fuzzyUsed: true, expansionUsed: true };
      }
    }

    // Partial from Tier A+B
    if (mergedAB.length > 0) {
      const mapped = mergedAB.map((item: Record<string, unknown>) => mapDbItem(item, categoryKey)).filter(Boolean);
      return { items: null, fallbackItems: mapped, dbCount: mergedCount, durationMs: Date.now() - dbStartMs, tier: "B", fuzzyUsed: true, expansionUsed: false };
    }
  }

  // Partial from Tier A only
  if (tierACount > 0) {
    const mapped = tierAItems.map((item: Record<string, unknown>) => mapDbItem(item, categoryKey)).filter(Boolean);
    return { items: null, fallbackItems: mapped, dbCount: tierACount, durationMs: Date.now() - dbStartMs, tier: "A", fuzzyUsed: false, expansionUsed: false };
  }

  return { items: null, fallbackItems: null, dbCount: 0, durationMs: Date.now() - dbStartMs, tier: "none", fuzzyUsed: false, expansionUsed: false };
}

// ─── TIER A: Token-based ilike search ─────────────────────────────────────────
// Only select columns needed for search results — avoids transferring large metadata/images JSON
const DB_SELECT_COLS = "id,provider,provider_product_id,title,image_url,product_url,price_usd,currency,unified_category,category_key,rating,in_stock,is_disallowed,is_active,updated_at,popularity_score,last_seen_at,data_updated_at";

async function tierASearch(
  supabase: SupabaseClientAny,
  tokens: string[],
  categoryKey: string | null,
  limit: number,
  requestId: string,
  offset: number = 0,
): Promise<Record<string, unknown>[]> {
  let dbQuery = supabase
    .from("catalog_items")
    .select(DB_SELECT_COLS)
    .eq("is_disallowed", false)
    .eq("is_active", true)
    .not("image_url", "is", null)
    .gt("price_usd", 0);

  if (categoryKey) {
    dbQuery = dbQuery.or(`unified_category.eq.${categoryKey},unified_category.like.${categoryKey}_%`);
  }

  for (const token of tokens) {
    dbQuery = dbQuery.ilike("title", `%${token}%`);
  }

  const { data, error } = await dbQuery
    .order("rating", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (error) {
    console.warn(`[DB_TIER_A] requestId=${requestId} error: ${error.message}`);
    return [];
  }
  return data || [];
}

// ─── TIER B: pg_trgm fuzzy similarity search ─────────────────────────────────
async function tierBFuzzySearch(
  supabase: SupabaseClientAny,
  qNorm: string,
  categoryKey: string | null,
  limit: number,
  requestId: string,
): Promise<Record<string, unknown>[]> {
  try {
    // Use the existing search_catalog_items_ranked RPC which uses pg_trgm similarity
    const { data, error } = await supabase.rpc("search_catalog_items_ranked", {
      p_query: qNorm,
      p_min_price: 0,
      p_max_price: null,
      p_limit: Math.min(limit, 400),
    });

    if (error) {
      console.warn(`[DB_TIER_B] requestId=${requestId} rpc error: ${error.message}`);
      return [];
    }

    if (!data || data.length === 0) return [];

    // The RPC returns a simplified shape, we need to fetch full records for matching IDs
    // Filter by category if needed
    let results = data;
    if (categoryKey) {
      // RPC doesn't filter by category, do post-filter
      // For efficiency, just use the IDs and fetch from catalog_items
    const ids = results.map((r: any) => r.id);
      if (ids.length > 0) {
        const { data: fullItems } = await supabase
          .from("catalog_items")
          .select(DB_SELECT_COLS)
          .in("id", ids)
          .or(`unified_category.eq.${categoryKey},unified_category.like.${categoryKey}_%`)
          .eq("is_active", true)
          .eq("is_disallowed", false);
        return fullItems || [];
      }
    }

    // No category filter — fetch full records by IDs, preserving relevance order
    const ids = results.map((r: any) => r.id);
    if (ids.length > 0) {
      const { data: fullItems } = await supabase
        .from("catalog_items")
        .select(DB_SELECT_COLS)
        .in("id", ids)
        .eq("is_active", true)
        .eq("is_disallowed", false);
      if (fullItems && fullItems.length > 0) {
        // Preserve RPC relevance order using array_position
        const idOrder = new Map(ids.map((id: string, idx: number) => [id, idx]));
        fullItems.sort((a: any, b: any) => (idOrder.get(a.id) ?? 999) - (idOrder.get(b.id) ?? 999));
      }
      return fullItems || [];
    }

    return [];
  } catch (err) {
    console.warn(`[DB_TIER_B] requestId=${requestId} error: ${(err as Error).message}`);
    return [];
  }
}

// ─── TIER C: Query Expansion Generator ────────────────────────────────────────
function generateExpansionQueries(qNorm: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  seen.add(qNorm);

  // 1. Strip year tokens: "2024 tesla model x" → "tesla model x"
  const yearMatch = qNorm.match(/\b(19|20)\d{2}\b/);
  const noYear = qNorm.replace(/\b(19|20)\d{2}\b/g, "").replace(/\s+/g, " ").trim();
  if (noYear && noYear !== qNorm && !seen.has(noYear)) {
    results.push(noYear);
    seen.add(noYear);
  }

  // 2. Add nearby years if year was found
  if (yearMatch) {
    const year = parseInt(yearMatch[0]);
    const nearYears = [year - 1, year - 2, year + 1].filter(y => y >= 2015 && y <= 2026);
    const base = noYear || qNorm.replace(yearMatch[0], "").trim();
    for (const ny of nearYears) {
      const q = `${ny} ${base}`.trim();
      if (!seen.has(q)) {
        results.push(q);
        seen.add(q);
      }
    }
  }

  // 3. Add FR/EN synonyms for tokens
  const tokens = qNorm.split(/\s+/);
  for (const token of tokens) {
    const synonyms = EXPANSION_SYNONYMS[token.toLowerCase()];
    if (synonyms) {
      for (const syn of synonyms.slice(0, 2)) {
        const q = qNorm.replace(new RegExp(`\\b${escapeRegex(token)}\\b`, "i"), syn).trim();
        if (!seen.has(q)) {
          results.push(q);
          seen.add(q);
        }
        if (results.length >= 8) break;
      }
    }
    if (results.length >= 8) break;
  }

  return results.slice(0, 8);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
