/**
 * Smart "Similar Query" Global Cache Matching
 * 
 * When exact cache miss, attempts to find a near-match in the global cache
 * using token-based Jaccard similarity (>= 0.75 threshold).
 * 
 * CRITICAL: This is GLOBAL cache — no user/session/device scoping.
 */

type SupabaseClient = any;

// ─── STOPWORDS (EN + FR) ─────────────────────────────────────────────────────
// Light stopwords that don't affect search intent — removed for cache matching
const STOPWORDS = new Set([
  // English
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "is", "it", "its", "be", "as", "do", "no", "not",
  "so", "if", "up", "out", "off", "all", "just", "from", "into", "over",
  "about", "after", "some", "than", "very", "also", "that", "this", "each",
  // French
  "le", "la", "les", "un", "une", "des", "du", "de", "et", "ou", "en",
  "au", "aux", "ce", "se", "ne", "pas", "pour", "par", "sur", "avec",
  "dans", "son", "sa", "ses", "est", "sont", "qui", "que", "quoi",
  "mais", "donc", "car", "ni", "très", "tres", "aussi", "plus",
]);

/**
 * Tokenize and normalize a query for fingerprinting.
 * Removes stopwords, sorts tokens for deterministic fingerprint.
 */
export function tokenizeForFingerprint(query: string): string[] {
  const tokens = query
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t));
  // Deduplicate
  return [...new Set(tokens)];
}

/**
 * Remove stopwords from a normalized query string.
 * Used to enhance canonical query for better cache hits.
 */
export function removeStopwords(query: string): string {
  return query
    .split(/\s+/)
    .filter(t => t.length >= 2 && !STOPWORDS.has(t.toLowerCase()))
    .join(" ");
}

/**
 * Build a deterministic fingerprint from tokens.
 * Sorted unique tokens joined by "|".
 */
export function buildFingerprint(tokens: string[]): string {
  return [...tokens].sort().join("|");
}

/**
 * Compute Jaccard similarity between two token sets.
 * Returns value between 0 and 1.
 */
export function jaccardSimilarity(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 && tokensB.length === 0) return 1;
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const JACCARD_THRESHOLD = 0.75;

export interface NearMatchResult {
  hit: boolean;
  matchedCacheKey: string | null;
  matchedQuery: string | null;
  similarity: number;
  data: any;
  cacheAgeSec: number;
  ttlRemainingSec: number;
}

/**
 * Attempt a near-match lookup in the global cache.
 * 
 * Strategy:
 * 1. Query recent cache entries matching the same provider/vehicleMode/category prefix
 * 2. Compute Jaccard similarity between the query tokens and each cached query's tokens
 * 3. Return the best match above threshold
 * 
 * GLOBAL: No user/session filtering. Any user's cache is reusable.
 */
export async function findNearMatch(
  supabase: SupabaseClient,
  canonicalQuery: string,
  params: {
    provider: string;
    vehicleMode: boolean;
    categoryKey?: string;
    intentKey?: string;
    sort?: string;
    page?: number;
  },
  requestId: string,
): Promise<NearMatchResult> {
  const noHit: NearMatchResult = { hit: false, matchedCacheKey: null, matchedQuery: null, similarity: 0, data: null, cacheAgeSec: 0, ttlRemainingSec: 0 };

  const queryTokens = tokenizeForFingerprint(canonicalQuery);
  if (queryTokens.length === 0) return noHit;

  const queryFingerprint = buildFingerprint(queryTokens);

  try {
    // Build a prefix pattern to narrow down candidates
    // We match on cache_type='search' and look for entries with the same provider/vehicleMode
    const vmMarker = params.vehicleMode ? 1 : 0;
    const intentKey = params.intentKey || "general";
    const now = new Date().toISOString();

    // Fetch recent non-expired search cache entries
    // Filter by cache_type and use LIKE on cache_key for provider + vehicleMode match
    const keyPattern = `search:%:p=${params.provider}:%:vm=${vmMarker}:%:in=${intentKey}:%`;

    const { data: candidates, error } = await supabase
      .from("catalog_cache")
      .select("cache_key, query, response, updated_at, expires_at, stale_at")
      .eq("cache_type", "search")
      .like("cache_key", keyPattern)
      .gt("expires_at", now)
      .not("response->_negativeCached", "is", true)
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error || !candidates || candidates.length === 0) {
      return noHit;
    }

    let bestMatch: NearMatchResult = noHit;

    for (const candidate of candidates) {
      const candidateQuery = candidate.query || "";
      if (!candidateQuery) continue;

      // Check exact fingerprint match first
      const candidateTokens = tokenizeForFingerprint(candidateQuery);
      const candidateFingerprint = buildFingerprint(candidateTokens);

      let similarity: number;
      if (queryFingerprint === candidateFingerprint) {
        similarity = 1.0;
      } else {
        similarity = jaccardSimilarity(queryTokens, candidateTokens);
      }

      if (similarity >= JACCARD_THRESHOLD && similarity > bestMatch.similarity) {
        const updatedAt = new Date(candidate.updated_at);
        const expiresAt = new Date(candidate.expires_at);
        const nowMs = Date.now();
        const cacheAgeSec = Math.floor((nowMs - updatedAt.getTime()) / 1000);
        const ttlRemainingSec = Math.max(0, Math.floor((expiresAt.getTime() - nowMs) / 1000));

        // Validate the cached response has items
        const items = candidate.response?.items;
        if (!items || !Array.isArray(items) || items.length === 0) continue;

        bestMatch = {
          hit: true,
          matchedCacheKey: candidate.cache_key,
          matchedQuery: candidateQuery,
          similarity,
          data: candidate.response,
          cacheAgeSec,
          ttlRemainingSec,
        };

        // Perfect fingerprint match — stop searching
        if (similarity === 1.0) break;
      }
    }

    if (bestMatch.hit) {
      console.log(`[NEAR_MATCH] requestId=${requestId} FOUND: q="${canonicalQuery}" matched="${bestMatch.matchedQuery}" similarity=${bestMatch.similarity.toFixed(3)} age=${bestMatch.cacheAgeSec}s ttl=${bestMatch.ttlRemainingSec}s items=${bestMatch.data?.items?.length}`);
    }

    return bestMatch;
  } catch (err) {
    console.warn(`[NEAR_MATCH] requestId=${requestId} error:`, (err as Error).message);
    return noHit;
  }
}

/**
 * Assert that a cache key contains NO user identifiers.
 * Logs ERROR and strips identifiers if found.
 */
export function assertGlobalCacheKey(cacheKey: string, requestId: string): string {
  const USER_ID_PATTERNS = [
    /user[_-]?id=/i,
    /session[_-]?id=/i,
    /device[_-]?id=/i,
    /auth[_-]?token=/i,
    /ip=/i,
    /email=/i,
    /phone=/i,
    /uid=/i,
  ];

  for (const pattern of USER_ID_PATTERNS) {
    if (pattern.test(cacheKey)) {
      console.error(`[CACHE_GUARD] requestId=${requestId} ERROR: User identifier found in cache key! Pattern=${pattern.source} key=${cacheKey.slice(0, 100)}`);
      // Strip the offending segment
      cacheKey = cacheKey.replace(new RegExp(`${pattern.source}[^:]*:?`, "gi"), "");
    }
  }

  return cacheKey;
}
