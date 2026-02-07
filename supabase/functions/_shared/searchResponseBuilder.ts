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
};

/**
 * Build final response headers with dynamic Cache-Control.
 */
export function buildResponseHeaders(itemCount: number, cacheTtlSeconds: number): Record<string, string> {
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
  return headers;
}

export { corsHeaders };
