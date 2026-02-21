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
  // x-admin-key / x-cron-secret shortcuts
  const adminKey = req.headers.get("x-admin-key");
  const cronSecret = req.headers.get("x-cron-secret");
  const expectedAdmin = Deno.env.get("ADMIN_KEY");
  const expectedCron = Deno.env.get("CRON_SECRET");
  if (adminKey && expectedAdmin && adminKey === expectedAdmin) return true;
  if (cronSecret && expectedCron && cronSecret === expectedCron) return true;

  // JWT-based: check user_roles
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

  // Total counts
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

  // Per-category breakdown via RPC or manual aggregation
  // Use a raw query for efficiency
  const { data: catData } = await sb.rpc("admin_catalog_category_counts");

  // Thin categories
  const thin_categories = (catData || []).filter(
    (c: any) => c.active_count < 2000
  );

  return json({
    total_count: total_count ?? 0,
    active_count: active_count ?? 0,
    inactive_count: inactive_count ?? 0,
    dead_count: dead_count ?? 0,
    stale_price_count: stale_price_count ?? 0,
    not_seen_count: not_seen_count ?? 0,
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
      "id, provider, provider_product_id, category_key, unified_category, title, image_url, product_url, price_usd, currency, in_stock, is_active, status_reason, fail_count, last_seen_at, last_checked_at, price_updated_at, data_updated_at",
      { count: "exact" }
    );

  // Filters (indexed first)
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
    const d = new Date(
      Date.now() - parseInt(stalePriceDays) * 86400000
    ).toISOString();
    query = query.lt("price_updated_at", d);
  }

  const notSeenDays = url.searchParams.get("not_seen_days");
  if (notSeenDays) {
    const d = new Date(
      Date.now() - parseInt(notSeenDays) * 86400000
    ).toISOString();
    query = query.lt("last_seen_at", d);
  }

  // Text search (last, after indexed filters)
  const q = url.searchParams.get("q");
  if (q) query = query.ilike("title", `%${q}%`);

  // Order + paginate
  query = query
    .order("is_active", { ascending: false })
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .order("price_updated_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1);

  const { data: items, count: total_count, error } = await query;
  if (error) return json({ error: error.message }, 500);

  return json({ items: items || [], total_count: total_count ?? 0 });
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
