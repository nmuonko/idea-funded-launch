/**
 * Search Telemetry — Lightweight logging for search normalization quality
 * 
 * Logs search normalization events to `search_normalization_logs` for:
 *  - Zero-result feedback loop
 *  - Mining failing French queries
 *  - Auto-suggesting static-map additions
 * 
 * Fire-and-forget: never blocks search execution.
 */

import { createAdminPostgrestClient } from "./postgrest.ts";

export interface SearchTelemetryEvent {
  raw_query: string;
  normalized_query: string;
  detected_language: string;
  static_map_matched: boolean;
  dynamic_fallback_used: boolean;
  ai_translation_used: boolean;
  expansions: string[];
  result_count: number;
  request_id: string;
}

/**
 * Log a search normalization event (fire-and-forget).
 * Only logs when there's something interesting:
 *  - French/mixed query detected
 *  - Zero or low results
 *  - Dynamic fallback was used
 */
export function logSearchNormalization(event: SearchTelemetryEvent): void {
  // Only log interesting events (not every English exact-match)
  const isInteresting =
    event.detected_language !== "en" ||
    event.result_count <= 5 ||
    event.dynamic_fallback_used ||
    event.ai_translation_used;

  if (!isInteresting) return;

  try {
    const client = createAdminPostgrestClient();
    client
      .from("search_normalization_logs")
      .insert({
        raw_query: event.raw_query.slice(0, 200),
        normalized_query: event.normalized_query.slice(0, 200),
        detected_language: event.detected_language,
        static_map_matched: event.static_map_matched,
        dynamic_fallback_used: event.dynamic_fallback_used,
        ai_translation_used: event.ai_translation_used,
        expansions: event.expansions.slice(0, 5),
        result_count: event.result_count,
        request_id: event.request_id,
      })
      .execute()
      .then(() => {
        // Logged successfully
      })
      .catch((err) => {
        console.warn(`[TELEMETRY] log failed:`, (err as Error).message);
      });
  } catch (e) {
    // Never throw — telemetry is optional
    console.warn(`[TELEMETRY] error:`, (e as Error).message);
  }
}

/**
 * Query top failing search terms (for admin review).
 * Returns queries with zero or low results, ordered by frequency.
 */
export async function getTopFailingQueries(
  limit = 50,
  minOccurrences = 2,
): Promise<Array<{ raw_query: string; count: number; avg_results: number; detected_language: string }>> {
  try {
    const client = createAdminPostgrestClient();
    // Use a simple query — aggregation done client-side for now
    const { data, error } = await client
      .from("search_normalization_logs")
      .select("raw_query, detected_language, result_count")
      .lte("result_count", 5)
      .gte("created_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .order("created_at", { ascending: false })
      .limit(500)
      .execute();

    if (error || !data) return [];

    // Aggregate
    const counts: Record<string, { count: number; totalResults: number; lang: string }> = {};
    for (const row of data as any[]) {
      const key = row.raw_query?.toLowerCase()?.trim();
      if (!key) continue;
      if (!counts[key]) counts[key] = { count: 0, totalResults: 0, lang: row.detected_language };
      counts[key].count++;
      counts[key].totalResults += row.result_count || 0;
    }

    return Object.entries(counts)
      .filter(([_, v]) => v.count >= minOccurrences)
      .map(([q, v]) => ({
        raw_query: q,
        count: v.count,
        avg_results: Math.round(v.totalResults / v.count * 10) / 10,
        detected_language: v.lang,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  } catch {
    return [];
  }
}
