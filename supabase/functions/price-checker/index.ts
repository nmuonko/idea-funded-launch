/**
 * price-checker
 *
 * Re-verifies live prices for catalog products against the source (Amazon, eBay, etc.)
 * by reusing the `extract-price` edge function.
 *
 * Behavior:
 *   - Computes drift = |new - old| / old.
 *   - Drift <= AUTO_UPDATE_THRESHOLD (default 10%): silently update price_usd.
 *   - Drift  > AUTO_UPDATE_THRESHOLD: flag `needs_price_review = true` so the item
 *     is hidden from feeds until an admin approves.
 *   - Records each decision in `price_check_log`.
 *
 * Modes:
 *   POST { mode: "cron" }
 *     → Picks up to `limit` (default 40) of the most-stale items that haven't been
 *       checked in `staleHours` (default 24). Designed for pg_cron.
 *
 *   POST { mode: "items", itemIds: ["..."] }
 *     → Checks the explicit list of catalog_items.id. Used by checkout safety net.
 *
 *   POST { mode: "single", itemId: "..." }  ← convenience wrapper around "items"
 *
 * Response: { ok, checked, updated, flagged, failed, results: [...] }
 *
 * Auth: requires either service_role JWT (cron / server) or x-cron-secret header.
 *       Mobile/web clients should NOT call this directly.
 */

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const AUTO_UPDATE_THRESHOLD = 0.10; // 10% drift → silent auto-update; above → flag
const MIN_REASONABLE_PRICE = 1;
const MAX_REASONABLE_PRICE = 200_000;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";

interface CatalogItem {
  id: string;
  provider: string | null;
  provider_product_id: string | null;
  product_url: string | null;
  price_usd: number | null;
  title: string | null;
}

interface CheckResult {
  id: string;
  oldPrice: number | null;
  newPrice: number | null;
  driftPct: number | null;
  action: "auto_updated" | "flagged" | "no_change" | "extract_failed" | "skipped";
  error?: string;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function isAuthorized(req: Request): Promise<boolean> {
  // Allow cron header
  const cronHeader = req.headers.get("x-cron-secret");
  if (CRON_SECRET && cronHeader && cronHeader === CRON_SECRET) return true;

  // Allow service-role bearer
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (token && token === SERVICE_ROLE_KEY) return true;

  return false;
}

async function extractLivePrice(item: CatalogItem): Promise<{
  price: number | null;
  error?: string;
}> {
  if (!item.product_url) return { price: null, error: "no_product_url" };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/extract-price`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ url: item.product_url }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { price: null, error: `extract_http_${res.status}: ${text.slice(0, 120)}` };
    }
    const data = await res.json();
    const p = Number(data?.price ?? data?.price_usd ?? data?.basePrice ?? 0);
    if (!p || !isFinite(p) || p < MIN_REASONABLE_PRICE || p > MAX_REASONABLE_PRICE) {
      return { price: null, error: `unreasonable_price_${p}` };
    }
    return { price: p };
  } catch (e) {
    return { price: null, error: (e as Error).message.slice(0, 200) };
  }
}

async function checkItem(
  supabase: ReturnType<typeof createClient>,
  item: CatalogItem,
): Promise<CheckResult> {
  const oldPrice = Number(item.price_usd || 0);
  if (!oldPrice) {
    return { id: item.id, oldPrice: null, newPrice: null, driftPct: null, action: "skipped", error: "no_old_price" };
  }

  const { price: newPrice, error } = await extractLivePrice(item);
  const now = new Date().toISOString();

  if (!newPrice) {
    // Mark checked but failed; do not flag — just record so we don't loop.
    await supabase
      .from("catalog_items")
      .update({
        last_price_check_at: now,
        price_check_status: "extract_failed",
        price_check_error: error || "unknown",
      })
      .eq("id", item.id);

    await supabase.from("price_check_log").insert({
      catalog_item_id: item.id,
      provider: item.provider,
      provider_product_id: item.provider_product_id,
      old_price_usd: oldPrice,
      new_price_usd: null,
      drift_pct: null,
      action: "extract_failed",
      error: error || "unknown",
    });

    return {
      id: item.id, oldPrice, newPrice: null, driftPct: null,
      action: "extract_failed", error,
    };
  }

  const driftPct = Math.abs(newPrice - oldPrice) / oldPrice;

  if (driftPct < 0.005) {
    // <0.5% — treat as no change, just refresh timestamp.
    await supabase
      .from("catalog_items")
      .update({
        last_price_check_at: now,
        last_known_live_price_usd: newPrice,
        price_drift_pct: driftPct,
        price_check_status: "no_change",
        price_check_error: null,
      })
      .eq("id", item.id);
    return { id: item.id, oldPrice, newPrice, driftPct, action: "no_change" };
  }

  if (driftPct <= AUTO_UPDATE_THRESHOLD) {
    // Auto-update silently
    await supabase
      .from("catalog_items")
      .update({
        price_usd: newPrice,
        last_known_live_price_usd: newPrice,
        price_drift_pct: driftPct,
        last_price_check_at: now,
        price_updated_at: now,
        price_check_status: "auto_updated",
        price_check_error: null,
        needs_price_review: false,
      })
      .eq("id", item.id);

    await supabase.from("price_check_log").insert({
      catalog_item_id: item.id,
      provider: item.provider,
      provider_product_id: item.provider_product_id,
      old_price_usd: oldPrice,
      new_price_usd: newPrice,
      drift_pct: driftPct,
      action: "auto_updated",
    });
    return { id: item.id, oldPrice, newPrice, driftPct, action: "auto_updated" };
  }

  // Large drift → flag for admin review, hide from feeds.
  await supabase
    .from("catalog_items")
    .update({
      needs_price_review: true,
      last_known_live_price_usd: newPrice,
      price_drift_pct: driftPct,
      last_price_check_at: now,
      price_check_status: "flagged",
      price_check_error: null,
    })
    .eq("id", item.id);

  await supabase.from("price_check_log").insert({
    catalog_item_id: item.id,
    provider: item.provider,
    provider_product_id: item.provider_product_id,
    old_price_usd: oldPrice,
    new_price_usd: newPrice,
    drift_pct: driftPct,
    action: "flagged",
  });

  return { id: item.id, oldPrice, newPrice, driftPct, action: "flagged" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "method_not_allowed" }, 405);

  if (!(await isAuthorized(req))) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const mode = String((body as any)?.mode || "cron");
  const limit = Math.min(Math.max(Number((body as any)?.limit || 40), 1), 200);
  const staleHours = Math.max(Number((body as any)?.staleHours || 24), 1);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let items: CatalogItem[] = [];

  if (mode === "items" || mode === "single") {
    const ids = mode === "single"
      ? [String((body as any)?.itemId || "")].filter(Boolean)
      : Array.isArray((body as any)?.itemIds) ? (body as any).itemIds.map(String) : [];
    if (ids.length === 0) return jsonResponse({ ok: false, error: "itemIds required" }, 400);

    const { data, error } = await supabase
      .from("catalog_items")
      .select("id, provider, provider_product_id, product_url, price_usd, title")
      .in("id", ids);
    if (error) return jsonResponse({ ok: false, error: error.message }, 500);
    items = (data || []) as CatalogItem[];
  } else {
    // cron: pick stalest active items with a usable URL
    const cutoff = new Date(Date.now() - staleHours * 3600_000).toISOString();
    const { data, error } = await supabase
      .from("catalog_items")
      .select("id, provider, provider_product_id, product_url, price_usd, title")
      .eq("is_active", true)
      .or(`is_disallowed.is.null,is_disallowed.eq.false`)
      .not("product_url", "is", null)
      .gt("price_usd", 0)
      .or(`last_price_check_at.is.null,last_price_check_at.lt.${cutoff}`)
      .order("last_price_check_at", { ascending: true, nullsFirst: true })
      .limit(limit);
    if (error) return jsonResponse({ ok: false, error: error.message }, 500);
    items = (data || []) as CatalogItem[];
  }

  if (items.length === 0) {
    return jsonResponse({ ok: true, checked: 0, updated: 0, flagged: 0, failed: 0, results: [] });
  }

  // Run sequentially with small concurrency to respect upstream + edge CPU limits.
  const concurrency = 3;
  const results: CheckResult[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((it) => checkItem(supabase, it)));
    results.push(...batchResults);
  }

  const summary = {
    ok: true,
    checked: results.length,
    updated: results.filter((r) => r.action === "auto_updated").length,
    flagged: results.filter((r) => r.action === "flagged").length,
    failed: results.filter((r) => r.action === "extract_failed").length,
    no_change: results.filter((r) => r.action === "no_change").length,
    results,
  };

  console.log("[price-checker]", JSON.stringify({
    mode, count: items.length,
    updated: summary.updated, flagged: summary.flagged, failed: summary.failed,
  }));

  return jsonResponse(summary);
});
