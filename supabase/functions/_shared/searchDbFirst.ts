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

function mapDbItem(item: Record<string, unknown>, categoryKey: string | null): Record<string, unknown> {
  return {
    id: item.external_id || item.id,
    title: item.title,
    priceUsd: item.price_usd,
    price_usd: item.price_usd,
    currency: item.currency || "USD",
    imageUrl: item.image_url,
    image_url: item.image_url,
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
  const TARGET_RESULTS = 400; // Target for expansion tiers — pull broadly from 200K+ cached catalog

  // Build tokens from primary query — use only top 2 longest tokens
  // to cast a wider net (3 tokens is too restrictive for most queries)
  const searchTokens = qNorm.split(/\s+/).filter((t: string) => t.length >= 2);
  const topTokens = [...searchTokens].sort((a: string, b: string) => b.length - a.length).slice(0, 2);

  if (topTokens.length === 0) {
    return { items: null, fallbackItems: null, dbCount: 0, durationMs: Date.now() - dbStartMs, tier: "none", fuzzyUsed: false, expansionUsed: false };
  }

  // ─── TIER A: Token ilike match (fast, indexed) ─────────────────────────────
  const tierAItems = await tierASearch(supabase, topTokens, categoryKey, Math.max(limit, 800), requestId, offset);
  const tierACount = tierAItems.length;
  console.log(`[CATALOG_SEARCH] requestId=${requestId} db_tier_A q="${qNorm}" tokens=${JSON.stringify(topTokens)} count=${tierACount} minRequired=${DB_MIN_RESULTS}`);

  if (tierACount >= DB_MIN_RESULTS) {
    const mapped = tierAItems.map((item: Record<string, unknown>) => mapDbItem(item, categoryKey));
    const { allowed } = filterDisallowedItems(
      mapped.map((item: any) => ({ ...item, title: item.title, productUrl: item.productUrl, category: item.category })),
      `[DB_TIER_A] requestId=${requestId}`
    );
    return { items: allowed, fallbackItems: null, dbCount: tierACount, durationMs: Date.now() - dbStartMs, tier: "A", fuzzyUsed: false, expansionUsed: false };
  }

  // ─── TIER B: Fuzzy pg_trgm similarity (typo-tolerant) ─────────────────────
  const elapsed = Date.now() - dbStartMs;
  if (elapsed < 500) { // Only if we have time budget
    const tierBItems = await tierBFuzzySearch(supabase, qNorm, categoryKey, limit, requestId);
    // Merge and dedupe with Tier A
    const seenIds = new Set(tierAItems.map((i: any) => i.id));
    const newBItems = tierBItems.filter((i: any) => !seenIds.has(i.id));
    const mergedAB = [...tierAItems, ...newBItems];
    const mergedCount = mergedAB.length;
    console.log(`[CATALOG_SEARCH] requestId=${requestId} db_tier_B fuzzy q="${qNorm}" new=${newBItems.length} merged=${mergedCount}`);

    if (mergedCount >= DB_MIN_RESULTS) {
      const mapped = mergedAB.map((item: Record<string, unknown>) => mapDbItem(item, categoryKey));
      const { allowed } = filterDisallowedItems(
        mapped.map((item: any) => ({ ...item, title: item.title, productUrl: item.productUrl, category: item.category })),
        `[DB_TIER_B] requestId=${requestId}`
      );
      return { items: allowed, fallbackItems: null, dbCount: mergedCount, durationMs: Date.now() - dbStartMs, tier: "B", fuzzyUsed: true, expansionUsed: false };
    }

    // ─── TIER C: Query expansion ──────────────────────────────────────────────
    const elapsed2 = Date.now() - dbStartMs;
    if (elapsed2 < 600 && mergedCount < TARGET_RESULTS) {
      const expansionQueries = generateExpansionQueries(qNorm);
      let pool = [...mergedAB];
      const poolIds = new Set(pool.map((i: any) => i.id));

      for (const eq of expansionQueries) {
        if (pool.length >= TARGET_RESULTS) break;
        if (Date.now() - dbStartMs > 700) break;

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
        const mapped = pool.map((item: Record<string, unknown>) => mapDbItem(item, categoryKey));
        const { allowed } = filterDisallowedItems(
          mapped.map((item: any) => ({ ...item, title: item.title, productUrl: item.productUrl, category: item.category })),
          `[DB_TIER_C] requestId=${requestId}`
        );
        return { items: allowed, fallbackItems: null, dbCount: pool.length, durationMs: Date.now() - dbStartMs, tier: "C", fuzzyUsed: true, expansionUsed: true };
      }

      // Return whatever we have as fallback
      if (pool.length > 0) {
        const mapped = pool.map((item: Record<string, unknown>) => mapDbItem(item, categoryKey));
        return { items: null, fallbackItems: mapped, dbCount: pool.length, durationMs: Date.now() - dbStartMs, tier: "C", fuzzyUsed: true, expansionUsed: true };
      }
    }

    // Partial from Tier A+B
    if (mergedAB.length > 0) {
      const mapped = mergedAB.map((item: Record<string, unknown>) => mapDbItem(item, categoryKey));
      return { items: null, fallbackItems: mapped, dbCount: mergedCount, durationMs: Date.now() - dbStartMs, tier: "B", fuzzyUsed: true, expansionUsed: false };
    }
  }

  // Partial from Tier A only
  if (tierACount > 0) {
    const mapped = tierAItems.map((item: Record<string, unknown>) => mapDbItem(item, categoryKey));
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
      p_limit: Math.min(limit, 200),
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
