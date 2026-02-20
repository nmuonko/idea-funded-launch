/**
 * Query expansion utility for eBay-style "best matches + similar results" search.
 * 
 * Given a query like "2024 tesla model x plaid", generates:
 *   primary:  "2024 tesla model x plaid"        (exact)
 *   base:     "tesla model x plaid"              (year stripped)
 *   similars: ["tesla model x", "2023 tesla model x", "2022 tesla model x", ...]
 */

const YEAR_RE = /\b(19|20)\d{2}\b/g;

/** Noise words that can be stripped to create a relaxed variant */
const NOISE_WORDS = new Set([
  'unlocked', 'sealed', 'new', 'used', 'excellent', 'good', 'fair',
  'mint', 'pristine', 'refurbished', 'certified', 'oem', 'genuine',
  'original', 'authentic', 'factory', 'brand', 'latest', 'newest',
  'like', 'condition', 'great', 'perfect', 'clean', 'low', 'miles',
  'mileage', 'loaded', 'fully', 'one', 'owner', 'title', 'salvage',
  'rebuilt', 'lifted', 'custom', 'modified', 'stock', 'base',
]);

/** Size/storage tokens */
const SIZE_NOISE = /\b\d+\s*(gb|tb|mb|inch|in|mm|cm|oz|lb|kg)\b/gi;

export interface ExpandedQuery {
  /** Original query as-is */
  primary: string;
  /** Query with year removed */
  base: string;
  /** Array of broader/similar queries (no duplicates, no empty) */
  similars: string[];
  /** Individual meaningful tokens from the query (for relevance scoring) */
  tokens: string[];
  /** Detected year (if any) */
  year: string | null;
}

export function expandQuery(q: string): ExpandedQuery {
  const primary = q.trim();
  const tokens = primary.toLowerCase().split(/\s+/).filter(t => t.length > 1);

  // Detect year
  const yearMatch = primary.match(YEAR_RE);
  const year = yearMatch ? yearMatch[0] : null;

  // Base = year removed, trimmed
  const base = primary.replace(YEAR_RE, '').replace(/\s+/g, ' ').trim();

  // Relaxed = noise words + size tokens removed from base
  const relaxedTokens = base
    .split(/\s+/)
    .filter(t => !NOISE_WORDS.has(t.toLowerCase()))
    .join(' ')
    .replace(SIZE_NOISE, '')
    .replace(/\s+/g, ' ')
    .trim();

  const similars: string[] = [];
  const seen = new Set<string>();
  const addUnique = (s: string) => {
    const norm = s.toLowerCase().replace(/\s+/g, ' ').trim();
    if (norm && norm !== primary.toLowerCase() && !seen.has(norm)) {
      seen.add(norm);
      similars.push(s.trim());
    }
  };

  // 1) Base (year stripped) — always first similar
  if (base && base.toLowerCase() !== primary.toLowerCase()) {
    addUnique(base);
  }

  // 2) Relaxed variant (noise stripped from base)
  if (relaxedTokens && relaxedTokens !== base) {
    addUnique(relaxedTokens);
  }

  // 3) Nearby years (if year detected)
  if (year) {
    const y = parseInt(year, 10);
    // Generate ±3 years, excluding the original
    for (const offset of [-1, -2, 1, -3, -4, 2]) {
      const nearYear = y + offset;
      if (nearYear >= 1990 && nearYear <= 2030) {
        addUnique(primary.replace(year, String(nearYear)));
      }
    }
  }

  // 4) Progressive shortening of base (keep first N tokens, min 2)
  const baseTokens = base.split(/\s+/).filter(Boolean);
  if (baseTokens.length > 2) {
    // Drop last token
    addUnique(baseTokens.slice(0, -1).join(' '));
    // Keep only first 2 tokens (brand + model)
    if (baseTokens.length > 3) {
      addUnique(baseTokens.slice(0, 2).join(' '));
    }
  }

  return { primary, base, similars, tokens, year };
}

/**
 * Relevance scoring for ranking merged results.
 * Higher = more relevant to the original query.
 */
export function relevanceScore(title: string, queryTokens: string[], year: string | null): number {
  if (!title) return 0;
  const lower = title.toLowerCase();
  let score = 0;

  // +2 per token match
  for (const t of queryTokens) {
    if (lower.includes(t.toLowerCase())) score += 2;
  }

  // +3 if exact year match
  if (year && lower.includes(year)) score += 3;

  // +2 for multi-word model matches (e.g. "model x", "model 3", "yukon xl")
  for (let i = 0; i < queryTokens.length - 1; i++) {
    const bigram = `${queryTokens[i]} ${queryTokens[i + 1]}`.toLowerCase();
    if (lower.includes(bigram)) score += 2;
  }

  // Penalty for accessory-like words (vehicle context)
  const accessoryWords = ['adapter', 'charger', 'floor mat', 'seat cover', 'case', 'screen protector', 'cable', 'mount', 'holder', 'sticker', 'decal', 'keychain', 'toy', 'model car', 'diecast', 'scale'];
  for (const w of accessoryWords) {
    if (lower.includes(w)) score -= 3;
  }

  return score;
}
