/**
 * mobileSectionsCache.ts - Dedicated mobile sections cache
 * 
 * Stores PRE-BUILT strict sections (not the mixed pool).
 * Mobile requests hit this cache first. If miss/stale, rebuild strict
 * sections from pool + backfill, cache the RESULT, then serve.
 * 
 * This guarantees mobile never sees irrelevant items under section titles.
 */

import { SECTION_PROFILES, filterItemsForProfile, type SectionProfile, type SectionItem } from "./sectionProfiles.ts";
import { isValidProductImageUrl } from "./imageValidator.ts";
import { normalizeSectionTitles, calculateTotalItems } from "./titleNormalizer.ts";

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

export const MOBILE_SECTIONS_SCHEMA_VERSION = 4;
const DEFAULT_TTL_SECONDS = 1800; // 30 min default — overridden by admin settings
const ITEMS_PER_SECTION_RESPONSE = 20; // returned to client
const ITEMS_PER_SECTION_CACHE = 30; // stored in cache for stability

// (flattenToSingleSection removed — mobile needs multi-section response)

// ─── TYPES ────────────────────────────────────────────────────────────────────

interface CachedSectionsPayload {
  sections: Array<{
    key: string;
    title: string;
    title_en: string;
    title_fr: string;
    items: SectionItem[];
  }>;
  builtAt: number;
  itemCounts: Record<string, number>;
}

interface CacheRow {
  env: string;
  schema_version: number;
  built_at: string;
  ttl_seconds: number;
  payload: CachedSectionsPayload;
}

// ─── READ CACHE ───────────────────────────────────────────────────────────────

export async function readMobileSectionsCache(
  env: string,
  correlationId: string
): Promise<{ hit: boolean; payload: CachedSectionsPayload | null; ageSeconds: number }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return { hit: false, payload: null, ageSeconds: -1 };

  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/catalog_home_mobile_sections_cache?env=eq.${encodeURIComponent(env)}`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          Accept: "application/vnd.pgrst.object+json",
        },
      }
    );

    if (!res.ok || res.status === 406) {
      console.log(`[MOBILE_SECTIONS_CACHE] miss env=${env} reason=no_row correlationId=${correlationId}`);
      return { hit: false, payload: null, ageSeconds: -1 };
    }

    const row = await res.json() as CacheRow;

    // Schema version check — EXACT match required
    if (row.schema_version !== MOBILE_SECTIONS_SCHEMA_VERSION) {
      console.log(`[MOBILE_SECTIONS_CACHE] miss env=${env} reason=schema_mismatch cached=${row.schema_version} expected=${MOBILE_SECTIONS_SCHEMA_VERSION} correlationId=${correlationId}`);
      return { hit: false, payload: null, ageSeconds: -1 };
    }

    // TTL check
    const builtAt = new Date(row.built_at).getTime();
    const ageSeconds = Math.floor((Date.now() - builtAt) / 1000);
    if (ageSeconds > row.ttl_seconds) {
      console.log(`[MOBILE_SECTIONS_CACHE] miss env=${env} reason=expired age=${ageSeconds}s ttl=${row.ttl_seconds}s correlationId=${correlationId}`);
      return { hit: false, payload: null, ageSeconds };
    }

    // Valid hit
    const payload = row.payload as CachedSectionsPayload;
    if (!payload || !payload.sections || payload.sections.length === 0) {
      console.log(`[MOBILE_SECTIONS_CACHE] miss env=${env} reason=empty_payload correlationId=${correlationId}`);
      return { hit: false, payload: null, ageSeconds };
    }

    console.log(`[MOBILE_SECTIONS_CACHE] hit=true env=${env} schema=${row.schema_version} ageSeconds=${ageSeconds} correlationId=${correlationId}`);
    return { hit: true, payload, ageSeconds };
  } catch (err) {
    console.warn(`[MOBILE_SECTIONS_CACHE] read error: ${err}`);
    return { hit: false, payload: null, ageSeconds: -1 };
  }
}

// ─── WRITE CACHE ──────────────────────────────────────────────────────────────

async function writeMobileSectionsCache(
  env: string,
  payload: CachedSectionsPayload,
  correlationId: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<void> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return;

  try {
    await fetch(`${supabaseUrl}/rest/v1/catalog_home_mobile_sections_cache`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify({
        env,
        schema_version: MOBILE_SECTIONS_SCHEMA_VERSION,
        built_at: new Date().toISOString(),
        ttl_seconds: ttlSeconds,
        payload,
      }),
    });
    console.log(`[MOBILE_SECTIONS_CACHE] saved env=${env} correlationId=${correlationId}`);
  } catch (err) {
    console.warn(`[MOBILE_SECTIONS_CACHE] write error: ${err}`);
  }
}

// ─── BACKFILL PER PROFILE ─────────────────────────────────────────────────────

async function backfillForProfile(
  profile: SectionProfile,
  needed: number,
  usedIds: Set<string>
): Promise<SectionItem[]> {
  if (needed <= 0) return [];

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return [];

  try {
    const queryKeywords = profile.includeAny.slice(0, 8);
    const orClauses = queryKeywords
      .map(kw => `title.ilike.*${kw.replace(/ /g, "+")}*`)
      .join(",");

    const url = `${supabaseUrl}/rest/v1/catalog_items?` +
      `provider=in.(amazon,ebay,cargurus,carvana,shein)&price_usd=gt.0&image_url=not.is.null&is_disallowed=eq.false` + +
      `&or=(${orClauses})&order=updated_at.desc.nullslast&limit=${needed * 4}`;

    const res = await fetch(url, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });

    if (!res.ok) return [];

    const rows = await res.json() as Array<Record<string, unknown>>;
    if (!Array.isArray(rows) || rows.length === 0) return [];

    const mapped: SectionItem[] = rows
      .filter(row => isValidProductImageUrl(row.image_url as string | null))
      .map(row => ({
        id: `${row.provider}_${row.provider_product_id}`,
        provider: row.provider as string,
        provider_product_id: row.provider_product_id as string,
        title: (row.title as string) || "Product",
        price_usd: row.price_usd as number | null,
        priceUsd: row.price_usd as number | null,
        currency: "USD",
        image_url: row.image_url as string | null,
        imageUrl: row.image_url as string | null,
        product_url: row.product_url as string | null,
        productUrl: row.product_url as string | null,
        in_stock: true,
        segment: row.segment as string | undefined,
      }));

    return filterItemsForProfile(mapped, profile)
      .filter(item => !usedIds.has(item.id))
      .slice(0, needed);
  } catch (e) {
    console.warn(`[MOBILE_SECTIONS_CACHE] backfill error for ${profile.key}: ${e}`);
    return [];
  }
}

// ─── BUILD STRICT SECTIONS ───────────────────────────────────────────────────

/**
 * Build strict sections from a pool of items.
 * Phase 1: Filter pool using strict include/exclude per profile
 * Phase 2: Backfill under-populated sections from catalog_items DB
 * Stores up to ITEMS_PER_SECTION_CACHE per section.
 */
async function buildStrictSectionsFromPool(
  pool: SectionItem[],
  lang: "fr" | "en",
  correlationId: string
): Promise<CachedSectionsPayload> {
  const usedIds = new Set<string>();
  const sectionBuckets: Record<string, SectionItem[]> = {};

  for (const profile of SECTION_PROFILES) {
    sectionBuckets[profile.key] = [];
  }

  // PHASE 1: Strict filter from pool
  if (pool && pool.length > 0) {
    for (const profile of SECTION_PROFILES) {
      const filtered = filterItemsForProfile(pool, profile)
        .filter(item => !usedIds.has(item.id))
        .slice(0, ITEMS_PER_SECTION_CACHE);

      for (const item of filtered) {
        usedIds.add(item.id);
      }
      sectionBuckets[profile.key] = filtered;
    }
  }

  // PHASE 2: Backfill sections under threshold (parallel)
  const backfillTasks: Array<{ key: string; promise: Promise<SectionItem[]> }> = [];
  for (const profile of SECTION_PROFILES) {
    const current = sectionBuckets[profile.key].length;
    if (current < Math.min(profile.minItems, 5)) {
      const needed = ITEMS_PER_SECTION_CACHE - current;
      backfillTasks.push({
        key: profile.key,
        promise: backfillForProfile(profile, needed, usedIds),
      });
    }
  }

  if (backfillTasks.length > 0) {
    const results = await Promise.allSettled(backfillTasks.map(t => t.promise));
    for (let i = 0; i < backfillTasks.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled" && result.value.length > 0) {
        const key = backfillTasks[i].key;
        for (const item of result.value) {
          if (!usedIds.has(item.id)) {
            usedIds.add(item.id);
            sectionBuckets[key].push(item);
          }
        }
      }
    }
  }

  // Build final sections
  const sections: Array<{ key: string; title: string; title_en: string; title_fr: string; items: SectionItem[] }> = [];
  const itemCounts: Record<string, number> = {};

  for (const profile of SECTION_PROFILES) {
    const items = sectionBuckets[profile.key];
    itemCounts[profile.key] = items.length;
    sections.push({
      key: profile.key,
      title: lang === "fr" ? profile.title.fr : profile.title.en,
      title_fr: profile.title.fr,
      title_en: profile.title.en,
      items,
    });
  }

  // LOG COUNTS
  const countsLog = SECTION_PROFILES.map(p => `${p.key}=${itemCounts[p.key] || 0}`).join(" ");
  console.log(`[CATALOG_HOME][MOBILE_SECTIONS_COUNTS] env=production ${countsLog} correlationId=${correlationId}`);

  return { sections, builtAt: Date.now(), itemCounts };
}

// ─── MAIN: GET OR BUILD MOBILE SECTIONS ──────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-client-info, x-supabase-client-version, x-supabase-client-name, x-afrishop-environment, x-afrishop-client, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-device-id",
  "Access-Control-Expose-Headers": "content-type, x-correlation-id",
};

/**
 * Get mobile sections from cache or rebuild.
 * Returns a Response with ok:true and strict sections.
 */
export async function serveMobileSections(
  env: string,
  envRequested: string,
  lang: "fr" | "en",
  correlationId: string,
  detectedBy: string,
  poolItems: SectionItem[],
  ttlOverride?: number
): Promise<Response> {
  const effectiveTtl = ttlOverride && ttlOverride > 0 ? ttlOverride : DEFAULT_TTL_SECONDS;
  // 1) Try cache
  const { hit, payload, ageSeconds } = await readMobileSectionsCache(env, correlationId);

  if (hit && payload) {
    // Slice items to ITEMS_PER_SECTION_RESPONSE for the response
    const sliced = payload.sections.map(s => ({
      ...s,
      items: s.items.slice(0, ITEMS_PER_SECTION_RESPONSE),
    }));
    const normalized = normalizeSectionTitles(sliced, lang) as typeof sliced;
    const totalItems = calculateTotalItems(normalized);
    console.log(`[CATALOG_HOME][MODE] envRequested=${envRequested} envUsed=${env} isMobile=true sections=${normalized.length} keys=${normalized.map(s=>s.key).join(",")}`);

    return new Response(JSON.stringify({
      ok: true,
      sections: normalized,
      page: 1,
      pageSize: ITEMS_PER_SECTION_RESPONSE,
      totalPages: 1,
      totalItems,
      hasMore: false,
      hasMoreCached: false,
      ttlSeconds: effectiveTtl,
      correlationId,
      meta: {
        client: "mobile",
        detectedBy,
        envUsed: env,
        envRequested,
        source: "mobile_sections_cache",
        isStale: false,
        builtAt: payload.builtAt,
        ageSeconds,
        correlationId,
        ts: Date.now(),
        schemaVersion: MOBILE_SECTIONS_SCHEMA_VERSION,
      },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache" },
    });
  }

  // 2) Cache miss — check staging→production fallback before rebuilding
  if (poolItems.length === 0 && env !== "production") {
    console.log(`[MOBILE_SECTIONS_CACHE] env=${env} pool empty, trying production fallback correlationId=${correlationId}`);
    const prodCache = await readMobileSectionsCache("production", correlationId);
    if (prodCache.hit && prodCache.payload) {
      const sliced = prodCache.payload.sections.map(s => ({
        ...s,
        items: s.items.slice(0, ITEMS_PER_SECTION_RESPONSE),
      }));
      const normalized = normalizeSectionTitles(sliced, lang) as typeof sliced;
      const totalItems = calculateTotalItems(normalized);
      console.log(`[CATALOG_HOME][MODE] envRequested=${envRequested} envUsed=production isMobile=true sections=${normalized.length} keys=${normalized.map(s=>s.key).join(",")}`);

      return new Response(JSON.stringify({
        ok: true,
        sections: normalized,
        page: 1,
        pageSize: ITEMS_PER_SECTION_RESPONSE,
        totalPages: 1,
        totalItems,
        hasMore: false,
        hasMoreCached: false,
        ttlSeconds: effectiveTtl,
        correlationId,
        meta: {
          client: "mobile",
          detectedBy,
          envUsed: "production",
          envRequested,
          source: "staging_to_production_fallback",
          isStale: false,
          builtAt: prodCache.payload.builtAt,
          ageSeconds: prodCache.ageSeconds,
          correlationId,
          ts: Date.now(),
          schemaVersion: MOBILE_SECTIONS_SCHEMA_VERSION,
        },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache" },
      });
    }
  }

  // 3) Rebuild strict sections from pool
  console.log(`[MOBILE_SECTIONS_CACHE] rebuilding env=${env} poolSize=${poolItems.length} correlationId=${correlationId}`);

  const built = await buildStrictSectionsFromPool(poolItems, lang, correlationId);

  // 3) Save to cache (fire-and-forget)
  writeMobileSectionsCache(env, built, correlationId, effectiveTtl).catch(() => {});

  // 4) Slice for response
  const sliced = built.sections.map(s => ({
    ...s,
    items: s.items.slice(0, ITEMS_PER_SECTION_RESPONSE),
  }));
  const normalized = normalizeSectionTitles(sliced, lang) as typeof sliced;
  const totalItems = calculateTotalItems(normalized);
  console.log(`[CATALOG_HOME][MODE] envRequested=${envRequested} envUsed=${env} isMobile=true sections=${normalized.length} keys=${normalized.map(s=>s.key).join(",")}`);

  return new Response(JSON.stringify({
    ok: true,
    sections: normalized,
    page: 1,
    pageSize: ITEMS_PER_SECTION_RESPONSE,
    totalPages: 1,
    totalItems,
    hasMore: false,
    hasMoreCached: false,
    ttlSeconds: effectiveTtl,
    correlationId,
    meta: {
      client: "mobile",
      detectedBy,
      envUsed: env,
      envRequested,
      source: "rebuilt",
      isStale: false,
      builtAt: built.builtAt,
      correlationId,
      ts: Date.now(),
      schemaVersion: MOBILE_SECTIONS_SCHEMA_VERSION,
    },
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache" },
  });
}

/**
 * Emergency empty response — ok:true with empty sections
 */
export function emptyMobileSectionsResponse(
  lang: "fr" | "en",
  correlationId: string,
  env: string,
  envRequested: string,
  detectedBy: string,
  source: string = "empty_fallback"
): Response {
  const sections = SECTION_PROFILES.map(p => ({
    key: p.key,
    title: lang === "fr" ? p.title.fr : p.title.en,
    title_en: p.title.en,
    title_fr: p.title.fr,
    items: [],
  }));
  const normalized = normalizeSectionTitles(sections, lang) as typeof sections;
  const totalItems = calculateTotalItems(normalized);

  return new Response(JSON.stringify({
    ok: true,
    sections: normalized,
    page: 1,
    pageSize: ITEMS_PER_SECTION_RESPONSE,
    totalPages: 1,
    totalItems,
    hasMore: false,
    hasMoreCached: false,
    ttlSeconds: DEFAULT_TTL_SECONDS,
    correlationId,
    meta: {
      client: "mobile",
      detectedBy,
      envUsed: env,
      envRequested,
      source,
      isStale: true,
      correlationId,
      ts: Date.now(),
      schemaVersion: MOBILE_SECTIONS_SCHEMA_VERSION,
    },
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}
