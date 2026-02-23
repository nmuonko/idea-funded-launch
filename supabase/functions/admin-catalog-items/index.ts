import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  const limit = clamp(parseInt(url.searchParams.get("limit") || "50"), 1, 200);
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || "0"));

  let query = sb
    .from("catalog_items")
    .select(
      "id, provider, provider_product_id, category_key, unified_category, title, image_url, product_url, price_usd, currency, in_stock, is_active, status_reason, fail_count, last_seen_at, last_checked_at, price_updated_at, data_updated_at, first_seen_at, popularity_score",
      { count: "exact" }
    );

  // Filters
  const categoryKey = url.searchParams.get("category_key");
  if (categoryKey) query = query.eq("category_key", categoryKey);

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

  // Date range filters
  const dateFrom = url.searchParams.get("date_from");
  const dateTo = url.searchParams.get("date_to");
  const datePreset = url.searchParams.get("date_preset");

  if (datePreset) {
    const presetMs: Record<string, number> = { "24h": 86400000, "7d": 604800000, "30d": 2592000000 };
    const ms = presetMs[datePreset];
    if (ms) query = query.gte("first_seen_at", new Date(Date.now() - ms).toISOString());
  } else {
    if (dateFrom) query = query.gte("first_seen_at", dateFrom);
    if (dateTo) query = query.lte("first_seen_at", dateTo);
  }

  // Text search
  const q = url.searchParams.get("q");
  if (q) query = query.ilike("title", `%${q}%`);

  // Sorting
  const sortBy = url.searchParams.get("sort_by") || "newest";
  switch (sortBy) {
    case "recently_seen":
      query = query.order("last_seen_at", { ascending: false, nullsFirst: false });
      break;
    case "highest_price":
      query = query.order("price_usd", { ascending: false, nullsFirst: false });
      break;
    case "popularity":
      query = query.order("popularity_score", { ascending: false, nullsFirst: false });
      break;
    case "newest":
    default:
      query = query.order("first_seen_at", { ascending: false, nullsFirst: false });
      break;
  }

  query = query.range(offset, offset + limit - 1);

  const { data: items, count: total_count, error } = await query;
  if (error) return json({ error: error.message }, 500);

  return json({ items: items || [], total_count: total_count ?? 0 });
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

  if (action === "run-builder") {
    const provider = body.provider || "ebay";
    // Check provider health first
    const { data: health } = await sb
      .from("provider_health_status")
      .select("*")
      .eq("provider", provider)
      .maybeSingle();

    if (health && !health.healthy && health.unhealthy_until && new Date(health.unhealthy_until) > new Date()) {
      return json({ error: `Provider ${provider} is currently unhealthy: ${health.reason}`, unhealthy_until: health.unhealthy_until }, 429);
    }

    // Call catalog-refresh-worker with mode=catalog-builder
    const workerUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/catalog-refresh-worker`;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const res = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ mode: "catalog-builder", provider }),
    });

    const result = await res.json();
    return json({ success: true, worker_result: result });
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
