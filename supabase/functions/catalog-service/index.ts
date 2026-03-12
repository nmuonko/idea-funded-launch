/**
 * catalog-service — Consolidated router for lightweight catalog metadata endpoints
 *
 * Actions:
 *   tabs       — returns unified category tab list (from categoryMapper)
 *   categories — returns nav tabs/subtabs from DB (catalog_nav_tabs/subtabs)
 *   nav        — returns drawer sections, home rails, provider status
 *   providers  — returns provider list with active status
 *   prewarm    — triggers async home feed prewarming (admin/cron only)
 *
 * Auth:
 *   tabs, categories, nav, providers → public (read-only config)
 *   prewarm → requires admin JWT or x-cron-secret
 */

import { createClient } from "@supabase/supabase-js";
import { getEnvironmentFromRequest, EnvironmentName } from "../_shared/environmentResolver.ts";
import { createAdminPostgrestClient } from "../_shared/postgrest.ts";
import {
  TABS,
} from "../_shared/categoryMapper.ts";
import {
  CANONICAL_TABS,
  CANONICAL_SUBTABS,
  getCategoryMeta,
} from "../_shared/categoryRegistry.ts";
import { verifyCronAuth, cronAuthErrorResponse } from "../_shared/cronAuth.ts";
import { getRotationKey } from "../_shared/homeRotation.ts";
import { getCatalogSettings } from "../_shared/catalogSettings.ts";

// ─── CORS ────────────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-device-id, x-afrishop-environment, x-afrishop-client, x-supabase-client-info, x-supabase-client-version, x-supabase-client-name, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Max-Age": "86400",
};

function jsonRes(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });
}

function requestId() {
  return crypto.randomUUID().slice(0, 8);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: tabs
// ═══════════════════════════════════════════════════════════════════════════════

const HOME_SECTIONS_STATIC = [
  { key: "electronics", title: "Electronics", limit: 10 },
  { key: "vehicles", title: "Vehicles", limit: 10 },
  { key: "home_garden", title: "Home & Garden", limit: 10 },
  { key: "clothing_shoes_accessories", title: "Clothing", limit: 10 },
];

function handleTabs(req: Request): Response {
  const rid = requestId();
  let envName: EnvironmentName = "production";
  try { envName = getEnvironmentFromRequest(req); } catch { /* default */ }

  const responseTabs = TABS.map(tab => {
    const t: Record<string, unknown> = {
      key: tab.key,
      title: tab.title,
      icon: tab.icon || "package",
      providerPriority: tab.providerPriority || ["ebay"],
      allowLive: tab.allowLive !== false,
    };
    if (tab.listingType) t.listingType = tab.listingType;
    if (tab.subcategories?.length) {
      t.children = tab.subcategories.map(sub => ({
        key: sub.key, title: sub.title, icon: sub.icon, enabled: sub.enabled !== false,
      }));
    }
    return t;
  });

  console.log(`[CATALOG-SVC:tabs] rid=${rid} env=${envName} count=${responseTabs.length}`);
  return jsonRes({
    status: "success", env: envName, tabs: responseTabs,
    homeSections: HOME_SECTIONS_STATIC, error: null,
  }, 200, { "Cache-Control": "public, max-age=300" });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: categories
// ═══════════════════════════════════════════════════════════════════════════════

function buildFallbackTabs() {
  const iconMap: Record<string, string> = {
    electronics: "Smartphone", vehicles: "Car", home_garden: "Home",
    clothing_shoes_accessories: "Shirt", toys: "Gamepad2", sporting_goods: "Dumbbell",
    business_industrial: "Building", jewelry_watches: "Watch", refurbished: "RefreshCw",
    parts_accessories: "Wrench",
  };
  return CANONICAL_TABS.map((tabKey, index) => {
    const meta = getCategoryMeta(tabKey);
    const subtabKeys = CANONICAL_SUBTABS[tabKey] || [];
    return {
      key: tabKey,
      title_en: meta?.titleEn || tabKey,
      title_fr: meta?.titleFr || tabKey,
      icon: iconMap[tabKey] || null,
      order: index + 1,
      enabled: true,
      subtabs: subtabKeys.map((subKey, si) => {
        const sm = getCategoryMeta(subKey);
        return {
          key: subKey, title_en: sm?.titleEn || subKey, title_fr: sm?.titleFr || subKey,
          order: si, enabled: true, is_vehicle: sm?.isVehicle || false,
          is_parts: sm?.isParts || false, min_price_usd: sm?.minPrice || null,
        };
      }),
    };
  });
}

const FALLBACK_TABS = buildFallbackTabs();

async function handleCategories(req: Request): Promise<Response> {
  const rid = requestId();
  let envName: EnvironmentName = "production";
  try { envName = getEnvironmentFromRequest(req); } catch { /* default */ }

  try {
    const db = createAdminPostgrestClient();
    const [tabsRes, subtabsRes] = await Promise.all([
      db.from("catalog_nav_tabs").select("*").eq("enabled", true).order("order_index", { ascending: true }),
      db.from("catalog_nav_subtabs").select("*").eq("enabled", true).order("order_index", { ascending: true }),
    ]);

    if (tabsRes.error) {
      console.error(`[CATALOG-SVC:categories] rid=${rid} tabs error:`, tabsRes.error.message);
      return jsonRes({ status: "success", env: envName, tabs: FALLBACK_TABS, warning: { message: "DB error, using fallback", code: "DB_ERROR" }, error: null }, 200, { "Cache-Control": "public, max-age=300" });
    }

    const subtabsByParent: Record<string, unknown[]> = {};
    if (subtabsRes.data && Array.isArray(subtabsRes.data)) {
      for (const sub of subtabsRes.data as Record<string, unknown>[]) {
        const pk = sub.parent_key as string;
        if (!subtabsByParent[pk]) subtabsByParent[pk] = [];
        subtabsByParent[pk].push({
          key: sub.key, title_en: sub.title_en, title_fr: sub.title_fr,
          order: sub.order_index, enabled: sub.enabled,
          is_vehicle: (sub.is_vehicle as boolean) || false,
          is_parts: (sub.is_parts as boolean) || false,
          min_price_usd: sub.min_price_usd as number | null,
        });
      }
    }

    const tabs = ((tabsRes.data || []) as Record<string, unknown>[]).map(tab => ({
      key: tab.key as string, title_en: tab.title_en as string, title_fr: tab.title_fr as string,
      icon: tab.icon as string | null, order: tab.order_index as number,
      enabled: tab.enabled as boolean, subtabs: subtabsByParent[tab.key as string] || [],
    }));

    if (tabs.length === 0) {
      return jsonRes({ status: "success", env: envName, tabs: FALLBACK_TABS, warning: { message: "No tabs configured", code: "NO_TABS" }, error: null }, 200, { "Cache-Control": "public, max-age=300" });
    }

    console.log(`[CATALOG-SVC:categories] rid=${rid} env=${envName} tabs=${tabs.length}`);
    return jsonRes({ status: "success", env: envName, tabs, error: null }, 200, { "Cache-Control": "public, max-age=300" });
  } catch (err) {
    console.error(`[CATALOG-SVC:categories] rid=${rid} error:`, err);
    return jsonRes({ status: "success", env: envName, tabs: FALLBACK_TABS, warning: { message: "Internal error, using fallback", code: "INTERNAL_ERROR" }, error: null });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: nav
// ═══════════════════════════════════════════════════════════════════════════════

const PROVIDER_SECRET_MAP: Record<string, string> = {
  rainforest: "RAINFOREST_API_KEY", bluecart: "BLUECART_API_KEY",
  countdown: "COUNTDOWN_API_KEY", redcircle: "REDCIRCLE_API_KEY",
  bigbox: "BIGBOX_API_KEY", serpwow: "SERPWOW_API_KEY", scaleserp: "SCALESERP_API_KEY",
};
const PROVIDER_STORE_NAMES: Record<string, string> = {
  rainforest: "Amazon", bluecart: "Walmart", redcircle: "Target",
  bigbox: "Home Depot", serpwow: "Google Shopping", countdown: "Countdown",
};

function checkProviderActive(name: string, secretKeyName: string | null): { active: boolean; reason: "missing_api_key" | null } {
  const req = secretKeyName || PROVIDER_SECRET_MAP[name];
  if (!req) return { active: true, reason: null };
  try {
    const v = Deno.env.get(req);
    const ok = v !== undefined && v !== null && v.trim().length > 0;
    return { active: ok, reason: ok ? null : "missing_api_key" };
  } catch { return { active: false, reason: "missing_api_key" }; }
}

// In-memory cache for nav
const navCache = new Map<string, { data: unknown; expiresAt: number }>();
const NAV_CACHE_TTL = 5 * 60 * 1000;

async function handleNav(req: Request): Promise<Response> {
  const envName = getNavEnv(req);
  const cacheKey = `nav:${envName}`;
  const now = Date.now();

  const cached = navCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return jsonRes(cached.data, 200, { "Cache-Control": "public, max-age=300, stale-while-revalidate=60" });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const [catRes, provRes, navRes] = await Promise.all([
      supabase.from("catalog_categories").select("slug, title, group_title, enabled, priority, provider_scope, queries, icon").eq("enabled", true).order("priority", { ascending: false }),
      supabase.from("catalog_providers").select("name, display_name, enabled, priority, logo_url, color_hex, capabilities, secret_key_name, environment").or(`environment.eq.all,environment.eq.${envName}`).order("priority", { ascending: false }),
      supabase.from("catalog_nav_settings").select("home_sections, drawer_order, version").eq("key", "default").maybeSingle(),
    ]);

    const categories = catRes.data || [];
    const rawProviders = provRes.data || [];
    const navSettings = navRes.data;

    const providers = rawProviders.map((p: any) => {
      const isEnabled = p.enabled === true;
      const { active, reason } = checkProviderActive(p.name, p.secret_key_name);
      return {
        name: p.name, displayName: p.display_name || PROVIDER_STORE_NAMES[p.name] || p.name,
        enabled: isEnabled, active: isEnabled && active, priority: p.priority || 0,
        logoUrl: p.logo_url || null, colorHex: p.color_hex || null,
        providerStatusReason: !isEnabled ? "disabled" : reason,
      };
    });
    providers.sort((a: any, b: any) => { if (a.active !== b.active) return a.active ? -1 : 1; return b.priority - a.priority; });

    const categoryGroups = new Map<string, unknown[]>();
    for (const cat of categories as any[]) {
      const g = cat.group_title || "Other";
      if (!categoryGroups.has(g)) categoryGroups.set(g, []);
      categoryGroups.get(g)!.push({
        slug: cat.slug, title: cat.title, icon: cat.icon, enabled: cat.enabled,
        source: "db", providerScope: cat.provider_scope || "all", queries: cat.queries || [],
      });
    }

    const drawerOrder = (navSettings?.drawer_order || ["Electronics", "Charging", "Vehicles", "Stores"]) as string[];
    const drawer: { sectionTitle: string; items: unknown[] }[] = [];
    for (const st of drawerOrder) {
      if (st === "Stores") {
        const items = providers.map((p: any) => ({
          slug: p.name, title: PROVIDER_STORE_NAMES[p.name] || p.displayName, icon: "store",
          enabled: p.enabled, source: "provider", providerScope: p.name, queries: [],
          provider: p.name, active: p.active, badge: p.active ? null : "Soon",
          providerStatusReason: p.providerStatusReason,
        }));
        if (items.length > 0) drawer.push({ sectionTitle: "Stores", items });
      } else {
        const items = categoryGroups.get(st);
        if (items?.length) drawer.push({ sectionTitle: st, items });
      }
    }
    for (const [st, items] of categoryGroups) {
      if (!drawerOrder.includes(st) && items.length > 0) drawer.push({ sectionTitle: st, items });
    }

    const data = {
      status: "success", env: envName, version: navSettings?.version || 1,
      drawer, homeSections: (navSettings?.home_sections || []) as unknown[], providers, error: null,
    };
    navCache.set(cacheKey, { data, expiresAt: now + NAV_CACHE_TTL });
    return jsonRes(data, 200, { "Cache-Control": "public, max-age=300, stale-while-revalidate=60" });
  } catch (err) {
    console.error("[CATALOG-SVC:nav] Error:", err);
    return jsonRes({ status: "error", env: envName, version: 0, drawer: [], homeSections: [], providers: [], error: err instanceof Error ? err.message : "Unknown" });
  }
}

function getNavEnv(req: Request): "production" | "staging" {
  const resolved = getEnvironmentFromRequest(req);
  return resolved === "staging" ? "staging" : "production";
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: providers
// ═══════════════════════════════════════════════════════════════════════════════

function checkSecretExists(name: string): boolean {
  try { const v = Deno.env.get(name); return v !== undefined && v !== null && v.trim().length > 0; } catch { return false; }
}

function getRequiredSecret(provider: any): string | null {
  if (provider.requires_keys?.apiKeySecret) return provider.requires_keys.apiKeySecret;
  return PROVIDER_SECRET_MAP[provider.adapter_name || provider.name] || null;
}

async function handleProviders(req: Request): Promise<Response> {
  const envName = getEnvironmentFromRequest(req);
  const startTime = Date.now();

  const buildRes = (providers: unknown[], error: unknown = null) => {
    const active = (providers as any[]).filter(p => p.active);
    return {
      status: error ? "error" : "success", env: envName, providers,
      defaultProvider: active.length > 0 ? (active[0] as any).name : "all",
      providerUiMode: active.length <= 4 ? "tabs" : "dropdown",
      activeCount: active.length, error,
    };
  };

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) return jsonRes(buildRes([], { code: "CONFIG_ERROR", message: "Service unavailable" }));

    const supabase = createClient(url, key);
    const { data: providers, error: dbError } = await supabase
      .from("catalog_providers").select("*")
      .or(`environment.eq.all,environment.eq.${envName}`)
      .order("priority", { ascending: false });

    if (dbError) return jsonRes(buildRes([], { code: "DATABASE_ERROR", message: "Failed to fetch providers" }));

    const transformed = (providers || []).map((p: any) => {
      const isEnabled = p.enabled === true;
      const reqSecret = getRequiredSecret(p);
      const hasKey = reqSecret ? checkSecretExists(reqSecret) : true;
      const isActive = isEnabled && hasKey;
      return {
        name: p.name, displayName: p.display_name, active: isActive, enabled: isEnabled,
        priority: p.priority || 0, logoUrl: p.logo_url || null, colorHex: p.color_hex || null,
        capabilities: { home: p.capabilities?.home ?? false, search: p.capabilities?.search ?? false, product: p.capabilities?.product ?? false, offers: p.capabilities?.offers ?? false },
        providerStatusReason: !isEnabled ? "disabled" : (!hasKey ? "missing_api_key" : null),
      };
    });
    transformed.sort((a: any, b: any) => { if (a.active !== b.active) return a.active ? -1 : 1; return b.priority - a.priority; });

    console.log(`[CATALOG-SVC:providers] env=${envName} total=${transformed.length} active=${transformed.filter((p: any) => p.active).length} ms=${Date.now() - startTime}`);
    return jsonRes(buildRes(transformed), 200, { "Cache-Control": "public, max-age=300" });
  } catch (err) {
    console.error("[CATALOG-SVC:providers] Error:", err);
    return jsonRes(buildRes([], { code: "INTERNAL_ERROR", message: "Provider service error" }));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: prewarm
// ═══════════════════════════════════════════════════════════════════════════════

const HOME_PREWARM_SECTIONS = [
  { key: "homepage", categoryKey: "homepage" },
  { key: "phones", categoryKey: "electronics_phones" },
  { key: "electronics", categoryKey: "electronics" },
  { key: "vehicles", categoryKey: "vehicles_cars_trucks" },
  { key: "gaming", categoryKey: "electronics_gaming" },
  { key: "computers", categoryKey: "electronics_computers" },
  { key: "clothing", categoryKey: "clothing_shoes_accessories" },
  { key: "home_garden", categoryKey: "home_garden" },
  { key: "sporting_goods", categoryKey: "sporting_goods" },
  { key: "toys", categoryKey: "toys" },
  { key: "jewelry_watches", categoryKey: "jewelry_watches" },
  { key: "refurbished", categoryKey: "refurbished" },
  { key: "parts_accessories", categoryKey: "parts_accessories" },
  { key: "beauty_health", categoryKey: "beauty_health" },
  { key: "collectibles", categoryKey: "collectibles" },
  { key: "audio_music", categoryKey: "electronics_audio" },
  { key: "shoes_sneakers", categoryKey: "clothing_shoes" },
  { key: "cameras_photo", categoryKey: "electronics_cameras" },
];

async function handlePrewarm(req: Request): Promise<Response> {
  const rid = requestId();
  console.log(`[CATALOG-SVC:prewarm] rid=${rid} Starting`);

  // ─── AUTH ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  const cronSecretHeader = req.headers.get("x-cron-secret");
  let isAuthorized = false;
  let isCronJob = false;

  if (cronSecretHeader) {
    const cronAuth = verifyCronAuth(req);
    if (cronAuth.authorized) { isAuthorized = true; isCronJob = true; }
  }

  if (!isAuthorized && authHeader) {
    try {
      const url = Deno.env.get("SUPABASE_URL");
      const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (url && key) {
        const token = authHeader.replace("Bearer ", "");
        const adminSb = createClient(url, key);
        const { data: { user }, error: ue } = await adminSb.auth.getUser(token);
        if (!ue && user) {
          const { data: roleData } = await adminSb.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").single();
          if (roleData) isAuthorized = true;
        }
      }
    } catch (err) { console.error(`[CATALOG-SVC:prewarm] rid=${rid} auth error:`, err); }
  }

  if (!isAuthorized) {
    return cronAuthErrorResponse("Unauthorized - admin token or cron secret required");
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let sectionKey: string | null = null;
    if (req.method === "POST") {
      try { const body = await req.json(); sectionKey = body.sectionKey || null; } catch { /* no body */ }
    }

    const catalogSettings = await getCatalogSettings(supabase);
    const rotationKey = getRotationKey(catalogSettings.homeRotationIntervalMinutes);

    let sectionsTotal = HOME_PREWARM_SECTIONS.length;
    if (sectionKey) {
      const idx = HOME_PREWARM_SECTIONS.findIndex(s => s.key === sectionKey);
      if (idx === -1) return jsonRes({ ok: false, error: `Unknown section: ${sectionKey}` });
      sectionsTotal = 1;
    }

    const { data: job, error: jobError } = await supabase
      .from("prewarm_jobs")
      .insert({ status: "pending", rotation_key: rotationKey, sections_total: sectionsTotal, sections_completed: 0, amazon_fetched: 0, ebay_fetched: 0, mixed_total: 0 })
      .select().single();

    if (jobError || !job) {
      console.error(`[CATALOG-SVC:prewarm] rid=${rid} job create failed:`, jobError);
      return jsonRes({ ok: false, error: "Failed to create prewarm job" });
    }

    // Fire-and-forget worker
    const workerBody: Record<string, unknown> = { jobId: job.id };
    if (sectionKey) { workerBody.sectionKey = sectionKey; workerBody.singleSection = true; }

    fetch(`${supabaseUrl}/functions/v1/catalog-prewarm-worker`, {
      method: "POST",
      headers: { Authorization: `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(workerBody),
    }).then(r => console.log(`[CATALOG-SVC:prewarm] rid=${rid} worker status=${r.status}`))
      .catch(err => {
        console.error(`[CATALOG-SVC:prewarm] rid=${rid} worker failed:`, err);
        supabase.from("prewarm_jobs").update({ status: "failed", error_message: "Worker trigger failed" }).eq("id", job.id).then(() => {});
      });

    return jsonRes({
      ok: true, jobId: job.id, status: "queued", rotationKey, sectionsTotal,
      sectionKey: sectionKey || undefined,
      message: sectionKey ? `Prewarm started for section: ${sectionKey}` : "Home prewarm started in background",
      durationMs: Date.now() - Date.now(),
    });
  } catch (err) {
    console.error(`[CATALOG-SVC:prewarm] rid=${rid} error:`, err);
    return jsonRes({ ok: false, error: err instanceof Error ? err.message : "Unknown error" });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  switch (action) {
    case "tabs":
      return handleTabs(req);
    case "categories":
      return handleCategories(req);
    case "nav":
      return handleNav(req);
    case "providers":
      return handleProviders(req);
    case "prewarm":
      return handlePrewarm(req);
    default:
      return jsonRes({ error: "Missing or invalid ?action= parameter", validActions: ["tabs", "categories", "nav", "providers", "prewarm"] }, 400);
  }
});
