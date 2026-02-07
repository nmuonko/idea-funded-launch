/**
 * AI Query Refiner for catalog search
 * Checks DB cache first, then calls search-expand-query edge function with timeout.
 * Returns refined query and alternatives, or null on failure (zero regression).
 */

// Use 'any' type to avoid importing the Supabase SDK
type SupabaseClientAny = any;

const AI_REFINE_TIMEOUT_MS = 2000; // 2s timeout (increased from 1s for better refinement)

export interface AiRefineResult {
  refined: string;
  alt: string[];
  expandedTerms: string[];
}

export interface AiExpandResult {
  expandedTerms: string[] | null;
}

/**
 * Try to refine a search query using AI.
 * 1. Check search_query_expansions cache (fast, ~5ms)
 * 2. If miss, call search-expand-query edge function with 2s timeout
 * 3. Return null on any failure (caller falls back to original query)
 */
export async function expandQueryWithAi(
  supabase: SupabaseClientAny,
  qNorm: string,
  qOriginal: string,
  lang: string,
  requestId: string,
): Promise<string[] | null> {
  const result = await refineQueryWithAi(supabase, qNorm, qOriginal, lang, requestId);
  return result ? result.expandedTerms : null;
}

/**
 * Full refiner: returns refined query + alternatives.
 */
export async function refineQueryWithAi(
  supabase: SupabaseClientAny,
  qNorm: string,
  qOriginal: string,
  lang: string,
  requestId: string,
): Promise<AiRefineResult | null> {
  try {
    // 1. Check expansion cache first (fast, ~5ms)
    const { data: cached } = await supabase
      .from("search_query_expansions")
      .select("expanded_terms")
      .eq("query_normalized", qNorm)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (cached?.expanded_terms?.length) {
      console.log(`[CATALOG_SEARCH] requestId=${requestId} ai_refine_cache_hit: ${JSON.stringify(cached.expanded_terms)}`);
      return {
        refined: cached.expanded_terms[0],
        alt: cached.expanded_terms.slice(1),
        expandedTerms: cached.expanded_terms,
      };
    }

    // 2. Cache miss — call AI refiner function with timeout
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!SUPABASE_URL || !SERVICE_KEY) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_REFINE_TIMEOUT_MS);

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
    if (result.ok) {
      const refined = result.refined || (result.expandedTerms?.[0]) || qNorm;
      const alt = result.alt || result.expandedTerms?.slice(1) || [];
      const expandedTerms = [refined, ...alt].filter((t: string) => t && t.length >= 2).slice(0, 3);
      
      console.log(`[CATALOG_SEARCH] requestId=${requestId} ai_refined: "${qOriginal}" → "${refined}" alt=${JSON.stringify(alt)} cached=${result.cached}`);
      return { refined, alt, expandedTerms };
    }
    return null;
  } catch (err) {
    const errName = (err as Error).name;
    if (errName === "AbortError") {
      console.warn(`[CATALOG_SEARCH] requestId=${requestId} ai_refine_timeout`);
    }
    return null;
  }
}
