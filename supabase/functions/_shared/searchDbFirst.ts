/**
 * DB-First Search — queries catalog_items before hitting live providers.
 * Returns results instantly when DB has data, even if APIs are down.
 */

// Use 'any' type to avoid importing the Supabase SDK
type SupabaseClientAny = any;

import { filterDisallowedItems } from "./contentBlocker.ts";

export interface DbFirstParams {
  supabase: SupabaseClientAny;
  qNorm: string;
  aiExpandedTerms: string[] | null;
  limit: number;
  categoryKey: string | null;
  requestId: string;
}

export interface DbFirstResult {
  /** Mapped items ready for response (>= DB_MIN_RESULTS) */
  items: any[] | null;
  /** Partial fallback items (1..DB_MIN_RESULTS-1) */
  fallbackItems: any[] | null;
  dbCount: number;
  durationMs: number;
}

const DB_MIN_RESULTS = 4;

export async function searchDbFirst(params: DbFirstParams): Promise<DbFirstResult> {
  const { supabase, qNorm, aiExpandedTerms, limit, categoryKey, requestId } = params;
  const dbStartMs = Date.now();

  // Build tokens from primary query
  // Fix #2: exclude pure-number tokens AND single numeric-like tokens
  const searchTokens = qNorm.split(/\s+/).filter((t: string) => t.length >= 2 && !/^\d+$/.test(t));
  const topTokens = [...searchTokens].sort((a: string, b: string) => b.length - a.length).slice(0, 3);

  if (topTokens.length === 0) {
    return { items: null, fallbackItems: null, dbCount: 0, durationMs: Date.now() - dbStartMs };
  }

  let dbQuery = supabase
    .from("catalog_items")
    .select("*")
    .eq("is_disallowed", false)
    .filter("image_url", "not.is", "null")
    .gt("price_usd", 0);

  // Category filter: constrain DB results to selected category
  if (categoryKey) {
    // For top-level tabs, also match subtab categories (e.g. electronics matches electronics_phones)
    dbQuery = dbQuery.or(`unified_category.eq.${categoryKey},unified_category.like.${categoryKey}_%`);
    console.log(`[CATALOG_SEARCH] requestId=${requestId} db_first category_filter="${categoryKey}"`);
  }

  for (const token of topTokens) {
    dbQuery = dbQuery.ilike("title", `%${token}%`);
  }

  const { data: dbItems, error: dbErr } = await dbQuery
    .order("rating", { ascending: false, nullsFirst: false })
    .limit(limit);

  const dbMs = Date.now() - dbStartMs;
  const dbCount = dbItems?.length || 0;

  console.log(`[CATALOG_SEARCH] requestId=${requestId} db_first q="${qNorm}" tokens=${JSON.stringify(topTokens)} dbCount=${dbCount} ms=${dbMs}`);

  if (!dbItems || dbCount === 0) {
    return { items: null, fallbackItems: null, dbCount: 0, durationMs: dbMs };
  }

  // Map DB items to response format
  const mappedItems = dbItems.map((item: Record<string, unknown>) => ({
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
    imageCount: item.image_count || 1,
    category: item.unified_category || categoryKey,
    store: item.provider === "ebay" ? "ebay" : "amazon",
  }));

  if (dbCount >= DB_MIN_RESULTS) {
    // Apply content filtering
    const { allowed: filteredDbItems } = filterDisallowedItems(
      mappedItems.map((item: any) => ({ ...item, title: item.title, productUrl: item.productUrl, category: item.category })),
      `[DB_FIRST] requestId=${requestId}`
    );
    return { items: filteredDbItems, fallbackItems: null, dbCount, durationMs: dbMs };
  }

  // Fix #2: Partial results (1..DB_MIN_RESULTS-1) — ALWAYS save as fallback, never discard
  console.log(`[CATALOG_SEARCH] requestId=${requestId} db_first_partial dbCount=${dbCount} saved as fallback`);
  return { items: null, fallbackItems: mappedItems, dbCount, durationMs: dbMs };
}
