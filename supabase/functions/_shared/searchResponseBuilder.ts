/**
 * Search Response Builder — constructs search response objects and headers.
 */

import { buildProviderStats } from "./providerMixer.ts";

export interface SearchMeta {
  originalQuery: string;
  normalizedQuery: string;
  rewrittenQuery: string;
  rewriteApplied: boolean;
  ruleId: string | null;
  rulePriority: number | null;
  categoryKey: string | null;
}

export interface SearchResponse {
  status: string;
  env: string;
  query: string;
  items: any[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
  appliedFilters?: any;
  providerStats?: any;
  searchMeta: SearchMeta;
  mediaStats?: any;
  durationMs: number;
  ttlSeconds?: number;
  error: any;
  meta?: any;
  warning?: any;
  _cacheHit?: boolean;
  _cacheAgeSec?: number;
  // Pagination fields
  page?: number;
  returnedCount?: number;
  totalAvailableEstimate?: number;
  providersStatus?: {
    ebay: { ok: boolean; count: number; timedOut: boolean };
    amazon: { ok: boolean; count: number; timedOut: boolean };
  };
  qRefined?: string;
  sourcesUsed?: string[];
  partial?: boolean;
}

export function buildEmptyResponse(
  qOriginal: string,
  envName: string,
  searchMeta: SearchMeta,
  startTime: number,
  error?: { code: string; message: string },
): SearchResponse {
  return {
    status: error ? "error" : "success",
    env: envName,
    query: qOriginal,
    items: [],
    nextCursor: null,
    hasMore: false,
    total: 0,
    providerStats: buildProviderStats({
      mode: "unknown",
      amazonEnabled: false,
      ebayEnabled: false,
      amazonCacheHit: false,
      amazonBudgetRemaining: null,
      amazonReturned: 0,
      amazonCap: 0,
      amazonStatus: "disabled",
      ebayReturned: 0,
    }),
    searchMeta,
    durationMs: Date.now() - startTime,
    error: error || null,
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-afrishop-environment, x-device-id, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-afrishop-search-debug, x-afrishop-search-intent, X-Cache-Status, X-Cache-Age, X-Cache-TTL-Remaining, X-Results-Count, X-Next-Cursor, X-Cache-Match, X-Response-Time, X-Search-T-Total, X-Search-T-Rewrite, X-Search-T-Db, X-Search-T-Upstream, X-Search-T-AltQueries, X-Search-T-PostProcess, X-Translate, X-Translate-Ms, X-Translate-Provider",
};

/**
 * Build final response headers with dynamic Cache-Control.
 */
export interface SearchTimings {
  rewrite: number;
  aiRefine: number;
  dbFirst: number;
  providers: number;
  altQueries: number;
  postProcess: number;
  total: number;
}

export function buildResponseHeaders(
  itemCount: number,
  cacheTtlSeconds: number,
  extra?: { cacheStatus?: string; cacheAgeSec?: number; responseTimeMs?: number; timings?: SearchTimings }
): Record<string, string> {
  const cacheControlHeader = itemCount > 0
    ? `public, max-age=${Math.min(cacheTtlSeconds, 3600)}, s-maxage=${cacheTtlSeconds}`
    : "no-store, max-age=0";

  const headers: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": "application/json",
    "Cache-Control": cacheControlHeader,
    "Vary": "Origin, X-Afrishop-Environment",
  };
  if (itemCount === 0) {
    headers["Pragma"] = "no-cache";
    headers["Expires"] = "0";
  }
  // Cache status headers for client-side SWR
  if (extra?.cacheStatus) headers["X-Cache-Status"] = extra.cacheStatus;
  if (extra?.cacheAgeSec !== undefined) headers["X-Cache-Age"] = String(extra.cacheAgeSec);
  if (extra?.responseTimeMs !== undefined) headers["X-Response-Time"] = String(extra.responseTimeMs);
  // Timing breakdown headers
  if (extra?.timings) {
    const t = extra.timings;
    headers["X-Search-T-Total"] = String(t.total);
    headers["X-Search-T-Rewrite"] = String(t.rewrite);
    headers["X-Search-T-Db"] = String(t.dbFirst);
    headers["X-Search-T-Upstream"] = String(t.providers);
    headers["X-Search-T-AltQueries"] = String(t.altQueries);
    headers["X-Search-T-PostProcess"] = String(t.postProcess);
  }
  return headers;
}

export { corsHeaders };
