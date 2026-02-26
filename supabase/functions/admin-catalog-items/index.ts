import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveIngestionTarget, buildWorkerHeaders } from "../_shared/ingestionTarget.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-key, x-cron-secret",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function isAdmin(req: Request): Promise<boolean> {
  const adminKey = req.headers.get("x-admin-key");
  const cronSecret = req.headers.get("x-cron-secret");
  const expectedAdmin = Deno.env.get("ADMIN_KEY");
  const expectedCron = Deno.env.get("CRON_SECRET");
  if (adminKey && expectedAdmin && adminKey === expectedAdmin) return true;
  if (cronSecret && expectedCron && cronSecret === expectedCron) return true;

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;
  const token = auth.replace("Bearer ", "");

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, serviceKey);

  const {
    data: { user },
    error,
  } = await sb.auth.getUser(token);
  if (error || !user) return false;

  const { data: roles } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .limit(1);

  return (roles && roles.length > 0) ?? false;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleSummary(url: URL) {
  const sb = serviceClient();
  const staleDaysParam = parseInt(url.searchParams.get("stale_days") || "10");

  const { count: total_count } = await sb
    .from("catalog_items")
    .select("*", { count: "exact", head: true });

  const { count: active_count } = await sb
    .from("catalog_items")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true);

  const { count: inactive_count } = await sb
    .from("catalog_items")
    .select("*", { count: "exact", head: true })
    .eq("is_active", false);

  const { count: dead_count } = await sb
    .from("catalog_items")
    .select("*", { count: "exact", head: true })
    .gte("fail_count", 3);

  const staleDate = new Date(
    Date.now() - staleDaysParam * 2 * 86400000
  ).toISOString();
  const { count: stale_price_count } = await sb
    .from("catalog_items")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true)
    .lt("price_updated_at", staleDate);

  const notSeenDays = parseInt(url.searchParams.get("not_seen_days") || "30");
  const notSeenDate = new Date(
    Date.now() - notSeenDays * 86400000
  ).toISOString();
  const { count: not_seen_count } = await sb
    .from("catalog_items")
    .select("*", { count: "exact", head: true })
    .eq("is_active", true)
    .lt("last_seen_at", notSeenDate);

  const { data: catData } = await sb.rpc("admin_catalog_category_counts");

  const thin_categories = (catData || []).filter(
    (c: any) => c.active_count < 2000
  );

  // Items added in last 24h
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const { count: added_24h } = await sb
    .from("catalog_items")
    .select("*", { count: "exact", head: true })
    .gte("first_seen_at", yesterday);

  return json({
    total_count: total_count ?? 0,
    active_count: active_count ?? 0,
    inactive_count: inactive_count ?? 0,
    dead_count: dead_count ?? 0,
    stale_price_count: stale_price_count ?? 0,
    not_seen_count: not_seen_count ?? 0,
    added_24h: added_24h ?? 0,
    counts_by_category: catData || [],
    thin_categories,
  });
}

async function handleList(url: URL) {
  const sb = serviceClient();
  const limit = clamp(parseInt(url.searchParams.get("limit") || "50"), 1, 50);

  // Guardrail 1: Cursor-based pagination — no offset, no exact COUNT
  const ADMIN_LIST_COLUMNS = "id, provider, provider_product_id, category_key, unified_category, title, image_url, product_url, price_usd, currency, in_stock, is_active, status_reason, fail_count, last_seen_at, last_checked_at, price_updated_at, data_updated_at, first_seen_at, popularity_score";

  // Helper to apply shared filters to any query builder
  function applyFilters(query: any) {
    const categoryKey = url.searchParams.get("category_key");
    if (categoryKey) query = query.or(`category_key.eq.${categoryKey},unified_category.eq.${categoryKey}`);

    const provider = url.searchParams.get("provider");
    if (provider) query = query.eq("provider", provider);

    const isActive = url.searchParams.get("is_active");
    if (isActive === "true") query = query.eq("is_active", true);
    else if (isActive === "false") query = query.eq("is_active", false);

    const failMin = parseInt(url.searchParams.get("fail_min") || "0");
    if (failMin > 0) query = query.gte("fail_count", failMin);

    const stalePriceDays = url.searchParams.get("stale_price_days");
    if (stalePriceDays) {
      const d = new Date(Date.now() - parseInt(stalePriceDays) * 86400000).toISOString();
      query = query.lt("price_updated_at", d);
    }

    const notSeenDays = url.searchParams.get("not_seen_days");
    if (notSeenDays) {
      const d = new Date(Date.now() - parseInt(notSeenDays) * 86400000).toISOString();
      query = query.lt("last_seen_at", d);
    }

    const datePreset = url.searchParams.get("date_preset");
    const dateFrom = url.searchParams.get("date_from");
    const dateTo = url.searchParams.get("date_to");

    if (datePreset) {
      if (datePreset === "today") {
        const todayStart = new Date();
        todayStart.setUTCHours(0, 0, 0, 0);
        query = query.gte("first_seen_at", todayStart.toISOString());
      } else {
        const presetMs: Record<string, number> = { "1h": 3600000, "24h": 86400000, "7d": 604800000, "30d": 2592000000 };
        const ms = presetMs[datePreset];
        if (ms) query = query.gte("first_seen_at", new Date(Date.now() - ms).toISOString());
      }
    } else {
      if (dateFrom) query = query.gte("first_seen_at", dateFrom);
      if (dateTo) query = query.lte("first_seen_at", dateTo);
    }

    const q = url.searchParams.get("q");
    if (q) query = query.ilike("title", `%${q}%`);

    return query;
  }

  // Check if any filter is active
  const hasFilters = !!(
    url.searchParams.get("category_key") ||
    url.searchParams.get("provider") ||
    url.searchParams.get("is_active") ||
    url.searchParams.get("q") ||
    url.searchParams.get("stale_price_days") ||
    url.searchParams.get("not_seen_days") ||
    url.searchParams.get("date_preset") ||
    url.searchParams.get("date_from") ||
    url.searchParams.get("date_to") ||
    parseInt(url.searchParams.get("fail_min") || "0") > 0
  );

  // Get filtered count (only when filters are active, to avoid expensive unfiltered counts)
  let filteredCount: number | null = null;
  if (hasFilters) {
    try {
      let countQuery = sb.from("catalog_items").select("*", { count: "exact", head: true });
      countQuery = applyFilters(countQuery);
      const { count, error: countError } = await countQuery;
      if (countError) {
        console.error("[admin-catalog-items] Count query error:", countError.message);
        // Retry with a simpler count
        const retryQuery = applyFilters(sb.from("catalog_items").select("id", { count: "exact", head: true }));
        const { count: retryCount } = await retryQuery;
        filteredCount = retryCount ?? null;
      } else {
        filteredCount = count ?? 0;
      }
    } catch (e) {
      console.error("[admin-catalog-items] Count query exception:", e);
      filteredCount = null;
    }
  }

  // Build data query
  let query = sb.from("catalog_items").select(ADMIN_LIST_COLUMNS);
  query = applyFilters(query);

  // Sorting + cursor-based pagination
  const sortBy = url.searchParams.get("sort_by") || "newest";
  const cursor = url.searchParams.get("cursor"); // ISO date or number
  const cursorId = url.searchParams.get("cursor_id"); // tie-breaker

  // Determine sort column and apply cursor filter
  let sortCol: string;
  let sortAsc = false;
  switch (sortBy) {
    case "recently_seen": sortCol = "last_seen_at"; break;
    case "highest_price": sortCol = "price_usd"; break;
    case "popularity": sortCol = "popularity_score"; break;
    case "oldest": sortCol = "first_seen_at"; sortAsc = true; break;
    case "newest":
    default: sortCol = "first_seen_at"; break;
  }

  // Apply cursor: items after the cursor position
  if (cursor && cursorId) {
    if (sortAsc) {
      query = query.or(`${sortCol}.gt.${cursor},and(${sortCol}.eq.${cursor},id.gt.${cursorId})`);
    } else {
      query = query.or(`${sortCol}.lt.${cursor},and(${sortCol}.eq.${cursor},id.gt.${cursorId})`);
    }
  }

  query = query
    .order(sortCol, { ascending: sortAsc, nullsFirst: false })
    .order("id", { ascending: true }) // tie-breaker
    .limit(limit + 1); // fetch one extra to detect "has more"

  const { data: rawItems, error } = await query;
  if (error) return json({ error: error.message }, 500);

  const items = (rawItems || []).slice(0, limit);
  const hasMore = (rawItems || []).length > limit;

  // Build next_cursor from last item
  let next_cursor: string | null = null;
  let next_cursor_id: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1] as any;
    next_cursor = last[sortCol] ?? null;
    next_cursor_id = last.id;
  }

  return json({ items, has_more: hasMore, next_cursor, next_cursor_id, filtered_count: filteredCount });
}

async function handleBuilderStatus() {
  const sb = serviceClient();

  // Active campaign
  const { data: campaign } = await sb
    .from("catalog_builder_goals")
    .select("*")
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Queue depth
  const { count: queued } = await sb.from("catalog_refresh_queue").select("*", { count: "exact", head: true }).eq("status", "queued");
  const { count: running } = await sb.from("catalog_refresh_queue").select("*", { count: "exact", head: true }).eq("status", "running");

  // Items added 24h
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const { count: added_24h } = await sb.from("catalog_items").select("*", { count: "exact", head: true }).gte("first_seen_at", yesterday);

  // Provider health
  const { data: health } = await sb.from("provider_health_status").select("*");

  // Recent runs
  const { data: recentRuns } = await sb
    .from("catalog_builder_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(10);

  return json({
    campaign,
    queue: { queued: queued ?? 0, running: running ?? 0 },
    added_24h: added_24h ?? 0,
    provider_health: health || [],
    recent_runs: recentRuns || [],
  });
}

async function handleSearchInsights() {
  const sb = serviceClient();

  // Top queries from search_query_log
  const { data: topQueries } = await sb.rpc("get_popular_queries", { p_window_hours: 168, p_limit: 30 });

  // Most popular products
  const { data: popularItems } = await sb
    .from("catalog_items")
    .select("id, title, image_url, provider, price_usd, popularity_score, category_key")
    .eq("is_active", true)
    .gt("popularity_score", 0)
    .order("popularity_score", { ascending: false })
    .limit(20);

  return json({
    top_queries: topQueries || [],
    popular_items: popularItems || [],
  });
}

async function handleAction(req: Request, action: string) {
  const sb = serviceClient();
  const body = await req.json().catch(() => ({}));

  if (action === "deactivate") {
    if (!body.id) return json({ error: "id required" }, 400);
    const { error } = await sb
      .from("catalog_items")
      .update({
        is_active: false,
        status_reason: body.reason || "admin_deactivated",
        updated_at: new Date().toISOString(),
      })
      .eq("id", body.id);
    if (error) return json({ error: error.message }, 500);
    return json({ success: true });
  }

  if (action === "reactivate") {
    if (!body.id) return json({ error: "id required" }, 400);
    const { error } = await sb
      .from("catalog_items")
      .update({
        is_active: true,
        status_reason: "active",
        fail_count: 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", body.id);
    if (error) return json({ error: error.message }, 500);
    return json({ success: true });
  }

  if (action === "force_refresh") {
    const category = body.category_key;
    const provider = body.provider || "ebay";
    const query = body.query || body.title || "refresh";
    if (!category) return json({ error: "category_key required" }, 400);

    const { error } = await sb.from("catalog_refresh_queue").insert({
      category_key: category,
      provider,
      query,
      priority: 1,
      status: "queued",
      scheduled_at: new Date().toISOString(),
    });
    if (error) return json({ error: error.message }, 500);
    return json({ success: true });
  }

  if (action === "get-ingestion-target") {
    const { targetBaseUrl, isRemoteTarget, localBaseUrl } = await resolveIngestionTarget(sb);
    return json({ targetBaseUrl, isRemoteTarget, localBaseUrl });
  }

  if (action === "set-ingestion-target") {
    const url = body.url?.trim();
    if (!url) return json({ error: "url required" }, 400);
    if (!url.startsWith("https://") || !url.includes("/functions/v1")) {
      return json({ error: "URL must be https://...supabase.co/functions/v1" }, 400);
    }
    const { error } = await sb.from("admin_settings").upsert(
      { key: "edge_function_base_url", value: url, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
    if (error) return json({ error: error.message }, 500);
    return json({ success: true, url });
  }

  if (action === "run-builder") {
    const provider = body.provider || "ebay";
    const categoryKey = body.category_key || undefined;
    const maxItemsTarget = body.max_items_target || 100;
    const customQuery = body.custom_query || undefined;

    // Check provider health first
    const { data: health } = await sb
      .from("provider_health_status")
      .select("*")
      .eq("provider", provider)
      .maybeSingle();

    if (health && !health.healthy && health.unhealthy_until && new Date(health.unhealthy_until) > new Date()) {
      return json({ error: `Provider ${provider} is currently unhealthy: ${health.reason}`, unhealthy_until: health.unhealthy_until }, 429);
    }

    // Route to target (Live if configured)
    const { targetBaseUrl } = await resolveIngestionTarget(sb);
    const workerUrl = `${targetBaseUrl}/catalog-refresh-worker`;
    console.log(`[run-builder] Routing to: ${workerUrl}`);

    const workerBody: Record<string, unknown> = { 
      mode: "catalog-builder", 
      provider,
      max_items_target: maxItemsTarget,
    };
    if (categoryKey) workerBody.category_key = categoryKey;
    if (customQuery) workerBody.custom_query = customQuery;

    const res = await fetch(workerUrl, {
      method: "POST",
      headers: buildWorkerHeaders(),
      body: JSON.stringify(workerBody),
    });

    const result = await res.json();
    return json({ success: true, worker_result: result, provider, routed_to: workerUrl });
  }

  if (action === "start-campaign") {
    const {
      run_window_days = 7,
      goal_total = 10000,
      goal_ebay = 5000,
      goal_rainforest = 5000,
      continuous = true,
    } = body;

    // Cancel any existing running campaign
    await sb
      .from("catalog_builder_goals")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("status", "running");

    const startAt = new Date();
    const endAt = new Date(startAt.getTime() + run_window_days * 86400000);

    const { data: campaign, error } = await sb
      .from("catalog_builder_goals")
      .insert({
        status: "running",
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        goal_total,
        goal_ebay,
        goal_rainforest,
        continuous,
      })
      .select()
      .single();

    if (error) return json({ error: error.message }, 500);
    return json({ success: true, campaign });
  }

  if (action === "cancel-campaign") {
    const { error } = await sb
      .from("catalog_builder_goals")
      .update({ status: "canceled", updated_at: new Date().toISOString() })
      .eq("status", "running");
    if (error) return json({ error: error.message }, 500);
    return json({ success: true });
  }

  if (action === "run-link-check") {
    const batchSize = body.batch_size || 50;
    const categoryKey = body.category_key || undefined;

    const { targetBaseUrl } = await resolveIngestionTarget(sb);
    const workerUrl = `${targetBaseUrl}/catalog-refresh-worker`;
    console.log(`[run-link-check] Routing to: ${workerUrl}`);

    const workerBody: Record<string, unknown> = {
      mode: "link-check",
      batch_size: Math.min(batchSize, 200),
    };
    if (categoryKey) workerBody.category_key = categoryKey;

    const res = await fetch(workerUrl, {
      method: "POST",
      headers: buildWorkerHeaders(),
      body: JSON.stringify(workerBody),
    });

    const result = await res.json();
    return json({ success: true, worker_result: result });
  }

  if (action === "run-car-scraper") {
    const { targetBaseUrl } = await resolveIngestionTarget(sb);
    const scraperUrl = `${targetBaseUrl}/catalog-car-scraper`;
    console.log(`[run-car-scraper] Routing to: ${scraperUrl}`);

    const res = await fetch(scraperUrl, {
      method: "POST",
      headers: buildWorkerHeaders(),
      body: JSON.stringify({
        provider: body.provider || "cargurus",
        max_price: body.max_price || 50000,
        max_pages: body.max_pages || 5,
        mode: body.mode || "firecrawl-first",
        search_query: body.custom_query || body.search_query || undefined,
        target_items: body.target_items || 10,
      }),
    });

    let result: any = null;
    try {
      result = await res.json();
    } catch {
      result = { ok: false, error: "Invalid scraper response" };
    }

    if (!res.ok || result?.ok === false) {
      return json(
        { error: result?.error || "Car scraper failed", worker_result: result, routed_to: scraperUrl },
        res.status >= 400 ? res.status : 500
      );
    }

    return json({ success: true, worker_result: result, routed_to: scraperUrl });
  }

  if (action === "run-shein-scraper") {
    const { targetBaseUrl } = await resolveIngestionTarget(sb);
    const scraperUrl = `${targetBaseUrl}/catalog-shein-scraper`;
    console.log(`[run-shein-scraper] Routing to: ${scraperUrl}`);

    const res = await fetch(scraperUrl, {
      method: "POST",
      headers: buildWorkerHeaders(),
      body: JSON.stringify({
        target_items: body.target_items || 20,
        max_pages: body.max_pages || 3,
        search_query: body.custom_query || body.search_query || undefined,
        dry_run: body.dry_run || false,
      }),
    });

    let result: any = null;
    try {
      result = await res.json();
    } catch {
      result = { ok: false, error: "Invalid SHEIN scraper response" };
    }

    if (!res.ok || result?.ok === false) {
      return json(
        { error: result?.error || "SHEIN scraper failed", worker_result: result, routed_to: scraperUrl },
        res.status >= 400 ? res.status : 500
      );
    }

    return json({ success: true, worker_result: result, routed_to: scraperUrl });
  }

  return json({ error: "unknown action" }, 400);
}

// ── Main ─────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  const start = Date.now();

  try {
    if (!(await isAdmin(req))) {
      return json({ error: "Unauthorized" }, 401);
    }

    const url = new URL(req.url);
    const mode = url.searchParams.get("mode");
    const action = url.searchParams.get("action");

    let response: Response;

    if (req.method === "GET" && mode === "summary") {
      response = await handleSummary(url);
    } else if (req.method === "GET" && mode === "list") {
      response = await handleList(url);
    } else if (req.method === "GET" && mode === "builder-status") {
      response = await handleBuilderStatus();
    } else if (req.method === "GET" && mode === "search-insights") {
      response = await handleSearchInsights();
    } else if (req.method === "POST" && action) {
      response = await handleAction(req, action);
    } else {
      response = json({ error: "Invalid mode/action" }, 400);
    }

    console.log(
      `[admin-catalog-items] ${req.method} mode=${mode} action=${action} ${Date.now() - start}ms`
    );
    return response;
  } catch (err) {
    console.error("[admin-catalog-items] Error:", err);
    return json({ error: "Internal error" }, 500);
  }
});
