/**
 * AI Query Expansion for catalog search
 * Checks DB cache first, then calls search-expand-query edge function with timeout.
 * Returns expanded terms or null on failure (zero regression).
 */

// Use 'any' type to avoid importing the Supabase SDK
type SupabaseClientAny = any;

const AI_EXPAND_TIMEOUT_MS = 1000;

export interface AiExpandResult {
  expandedTerms: string[] | null;
}

/**
 * Try to expand a search query using AI.
 * 1. Check search_query_expansions cache (fast, ~5ms)
 * 2. If miss, call search-expand-query edge function with 1s timeout
 * 3. Return null on any failure (caller falls back to original query)
 */
export async function expandQueryWithAi(
  supabase: SupabaseClientAny,
  qNorm: string,
  qOriginal: string,
  lang: string,
  requestId: string,
): Promise<string[] | null> {
  try {
    // 1. Check expansion cache first (fast, ~5ms)
    const { data: cached } = await supabase
      .from("search_query_expansions")
      .select("expanded_terms")
      .eq("query_normalized", qNorm)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (cached?.expanded_terms?.length) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} ai_expand_cache_hit: ${JSON.stringify(cached.expanded_terms)}`);
      return cached.expanded_terms;
    }

    // 2. Cache miss — call AI expansion function with timeout
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!SUPABASE_URL || !SERVICE_KEY) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_EXPAND_TIMEOUT_MS);

    const resp = await fetch(`${SUPABASE_URL}/functions/v1/search-expand-query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ query: qOriginal, lang }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) return null;

    const result = await resp.json();
    if (result.ok && Array.isArray(result.expandedTerms) && result.expandedTerms.length > 0) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} ai_expanded: ${JSON.stringify(result.expandedTerms)} cached=${result.cached}`);
      return result.expandedTerms;
    }
    return null;
  } catch (err) {
    const errName = (err as Error).name;
    if (errName === "AbortError") {
      console.warn(`[CATALOG_SEARCH] requestId=${requestId} ai_expand_timeout`);
    }
    return null;
  }
}
