/**
 * French Search Query Rewriter
 * 
 * Normalizes and rewrites French search queries to English
 * using database-backed rules with caching.
 * 
 * Features:
 * - Accent removal and normalization
 * - Pattern matching with priority ordering
 * - Category-specific expansions
 * - Brand/model preservation
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface RewriteRule {
  id: string;
  lang: string;
  pattern: string;
  rewrite: string;
  categoryKey: string | null;
  priority: number;
  enabled: boolean;
}

export interface SearchMeta {
  originalQuery: string;
  normalizedQuery: string;
  rewrittenQuery: string;
  rewriteApplied: boolean;
  ruleId: string | null;
  rulePriority: number | null;
  categoryKey: string | null;
}

// ─── NORMALIZATION ────────────────────────────────────────────────────────────

/**
 * Remove accents from French text
 */
function removeAccents(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Normalize query: lowercase, remove accents, trim, collapse whitespace
 */
export function normalizeQuery(query: string): string {
  return removeAccents(query)
    .toLowerCase()
    .replace(/['']/g, " ")     // Replace apostrophes with space
    .replace(/[^\w\s-]/g, " ") // Remove special chars except hyphens
    .replace(/\s+/g, " ")      // Collapse whitespace
    .trim();
}

// ─── BRAND/MODEL PRESERVATION ─────────────────────────────────────────────────

/**
 * Known brand patterns that should be preserved
 */
const BRAND_PATTERNS: RegExp[] = [
  // Phones
  /\b(iphone\s*\d+\s*(?:pro\s*max|pro|plus|mini)?)/i,
  /\b(samsung\s*(?:galaxy\s*)?(?:s|a|m|z|note)\d+\s*(?:ultra|plus|\+)?)/i,
  /\b(tecno\s*(?:spark|camon|phantom|pova)\s*\d*)/i,
  /\b(infinix\s*(?:hot|note|zero|smart)\s*\d*)/i,
  /\b(itel\s*(?:a|p|s)\d+)/i,
  /\b(huawei\s*(?:p|mate|nova)\s*\d*)/i,
  /\b(xiaomi\s*(?:redmi|poco|mi)\s*\d*)/i,
  /\b(oppo\s*(?:reno|find|a)\s*\d*)/i,
  
  // Gaming
  /\b(ps[1-5]\b)/i,
  /\b(playstation\s*[1-5])/i,
  /\b(xbox\s*(?:series\s*[xs]|one|360)?)/i,
  /\b(nintendo\s*(?:switch|3ds|wii)?)/i,
  
  // General model numbers
  /\b([a-zA-Z]+\d{2,}[a-zA-Z]*)/i,  // Like "A52s", "S23", etc.
];

/**
 * Extract preserved tokens (brands, models, numbers) from query
 */
function extractPreservedTokens(query: string): string[] {
  const tokens: string[] = [];
  
  for (const pattern of BRAND_PATTERNS) {
    const match = query.match(pattern);
    if (match) {
      tokens.push(match[0].toLowerCase());
    }
  }
  
  // Extract standalone numbers that might be model numbers
  const numberMatches = query.match(/\b\d+\s*(?:gb|tb|pro|max|plus|ultra)?\b/gi);
  if (numberMatches) {
    tokens.push(...numberMatches.map(m => m.toLowerCase()));
  }
  
  return tokens;
}

// ─── IN-MEMORY CACHE ──────────────────────────────────────────────────────────

interface CachedRules {
  rules: RewriteRule[];
  loadedAt: number;
}

const ruleCache: Map<string, CachedRules> = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Load rewrite rules from database with caching
 */
async function loadRules(
  supabase: SupabaseClient,
  lang: string,
  categoryKey: string | null,
  requestId: string
): Promise<RewriteRule[]> {
  const cacheKey = `${lang}:${categoryKey || "all"}`;
  const cached = ruleCache.get(cacheKey);
  
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.rules;
  }
  
  console.log(`[REWRITER] requestId=${requestId} Loading rules for lang=${lang} category=${categoryKey}`);
  
  // Build query
  let query = supabase
    .from("search_rewrites")
    .select("id, lang, pattern, rewrite, category_key, priority, enabled")
    .eq("lang", lang)
    .eq("enabled", true)
    .order("priority", { ascending: false });
  
  // If category provided, get rules for that category OR global rules (null category)
  if (categoryKey) {
    query = query.or(`category_key.eq.${categoryKey},category_key.is.null`);
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error(`[REWRITER] requestId=${requestId} Error loading rules:`, error.message);
    return [];
  }
  
  const rules: RewriteRule[] = (data || []).map(row => ({
    id: row.id,
    lang: row.lang,
    pattern: row.pattern,
    rewrite: row.rewrite,
    categoryKey: row.category_key,
    priority: row.priority,
    enabled: row.enabled,
  }));
  
  // Cache the rules
  ruleCache.set(cacheKey, { rules, loadedAt: Date.now() });
  
  console.log(`[REWRITER] requestId=${requestId} Loaded ${rules.length} rules`);
  return rules;
}

// ─── PATTERN MATCHING ─────────────────────────────────────────────────────────

/**
 * Find best matching rule for a normalized query
 */
function findMatchingRule(
  normalizedQuery: string,
  rules: RewriteRule[],
  categoryKey: string | null
): RewriteRule | null {
  // Sort by priority (highest first), then prefer category-specific over global
  const sorted = [...rules].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    // Prefer category-specific rules
    if (a.categoryKey && !b.categoryKey) return -1;
    if (!a.categoryKey && b.categoryKey) return 1;
    return 0;
  });
  
  for (const rule of sorted) {
    // If rule is category-specific, skip if wrong category
    if (rule.categoryKey && categoryKey && rule.categoryKey !== categoryKey) {
      continue;
    }
    
    // Check if pattern matches (exact match or as a word boundary)
    const pattern = normalizeQuery(rule.pattern);
    
    // Exact match
    if (normalizedQuery === pattern) {
      return rule;
    }
    
    // Contains as whole word (with word boundaries)
    const wordBoundaryPattern = new RegExp(`\\b${escapeRegex(pattern)}\\b`, "i");
    if (wordBoundaryPattern.test(normalizedQuery)) {
      return rule;
    }
  }
  
  return null;
}

/**
 * Escape regex special characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── REWRITE LOGIC ────────────────────────────────────────────────────────────

/**
 * Apply rewrite rule to query, preserving brand/model tokens
 */
function applyRewrite(
  originalQuery: string,
  normalizedQuery: string,
  rule: RewriteRule
): string {
  const preservedTokens = extractPreservedTokens(originalQuery);
  const pattern = normalizeQuery(rule.pattern);
  
  // Replace the matched pattern with the rewrite
  let rewritten = normalizedQuery;
  
  // Use word boundary replacement to avoid partial matches
  const wordBoundaryPattern = new RegExp(`\\b${escapeRegex(pattern)}\\b`, "gi");
  rewritten = rewritten.replace(wordBoundaryPattern, rule.rewrite);
  
  // Re-add preserved tokens if they were removed
  for (const token of preservedTokens) {
    if (!rewritten.toLowerCase().includes(token.toLowerCase())) {
      rewritten = `${rewritten} ${token}`;
    }
  }
  
  // Clean up
  return rewritten.replace(/\s+/g, " ").trim();
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

/**
 * Rewrite a search query from French to English
 */
export async function rewriteSearchQuery(
  supabase: SupabaseClient,
  originalQuery: string,
  options: {
    lang?: string;
    categoryKey?: string | null;
    requestId?: string;
  } = {}
): Promise<SearchMeta> {
  const {
    lang = "fr",
    categoryKey = null,
    requestId = "unknown",
  } = options;
  
  const normalizedQuery = normalizeQuery(originalQuery);
  
  // Default result (no rewrite)
  const defaultResult: SearchMeta = {
    originalQuery,
    normalizedQuery,
    rewrittenQuery: normalizedQuery,
    rewriteApplied: false,
    ruleId: null,
    rulePriority: null,
    categoryKey,
  };
  
  // Skip if query is too short
  if (normalizedQuery.length < 2) {
    return defaultResult;
  }
  
  // Skip if query appears to be already in English (simple heuristic)
  const frenchIndicators = /[àâäéèêëïîôùûüç]|^(le|la|les|un|une|des|du|de|pour|avec|sans)\s/i;
  const originalHasFrench = frenchIndicators.test(originalQuery);
  
  try {
    // Load rules
    const rules = await loadRules(supabase, lang, categoryKey, requestId);
    
    if (rules.length === 0) {
      console.log(`[REWRITER] requestId=${requestId} No rules found, returning normalized query`);
      return defaultResult;
    }
    
    // Find matching rule
    const matchingRule = findMatchingRule(normalizedQuery, rules, categoryKey);
    
    if (!matchingRule) {
      console.log(`[REWRITER] requestId=${requestId} No matching rule for: "${normalizedQuery}"`);
      return defaultResult;
    }
    
    // Apply rewrite
    const rewrittenQuery = applyRewrite(originalQuery, normalizedQuery, matchingRule);
    
    console.log(`[REWRITER] requestId=${requestId} Rewrote "${normalizedQuery}" → "${rewrittenQuery}" (rule: ${matchingRule.id}, priority: ${matchingRule.priority})`);
    
    return {
      originalQuery,
      normalizedQuery,
      rewrittenQuery,
      rewriteApplied: true,
      ruleId: matchingRule.id,
      rulePriority: matchingRule.priority,
      categoryKey: matchingRule.categoryKey,
    };
    
  } catch (err) {
    console.error(`[REWRITER] requestId=${requestId} Error:`, err);
    return defaultResult;
  }
}

/**
 * Clear the in-memory rule cache (for admin updates)
 */
export function clearRewriteCache(): void {
  ruleCache.clear();
  console.log("[REWRITER] Cache cleared");
}
