/**
 * cron-refresh-stale-prices
 *
 * Background sweep that keeps catalog prices ≤ 6h fresh so the price the user
 * sees on a product card / detail / cart row is the same price they will pay.
 *
 * Picks up to 200 stale catalog_items (last_price_check_at NULL or > 6h old,
 * OR currently flagged needs_price_review) and delegates to `price-checker`
 * in batches of 25.
 *
 * Auth: x-cron-secret header OR service-role bearer.
 * Schedule: every 6h via pg_cron.
 */

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CRON_SECRET = "afrishop-internal-cron-2026";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const STALE_HOURS = 6;
const MAX_ITEMS_PER_RUN = 200;
const BATCH_SIZE = 25;

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isAuthorized(req: Request): boolean {
  const cronHeader = req.headers.get("x-cron-secret");
  if (cronHeader && cronHeader === CRON_SECRET) return true;
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (token && token === SERVICE_ROLE_KEY) return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Always return 200 with JSON to keep mobile + cron happy
  if (!isAuthorized(req)) {
    return jsonResponse({ ok: false, code: "UNAUTHORIZED" }, 200);
  }

  const startedAt = Date.now();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const cutoff = new Date(Date.now() - STALE_HOURS * 3600_000).toISOString();

    // Stale items (never checked OR last check older than cutoff)
    const { data: staleItems, error: staleErr } = await supabase
      .from("catalog_items")
      .select("id, last_price_check_at, needs_price_review")
      .or(`last_price_check_at.is.null,last_price_check_at.lt.${cutoff}`)
      .order("last_price_check_at", { ascending: true, nullsFirst: true })
      .limit(MAX_ITEMS_PER_RUN);

    if (staleErr) {
      console.error("[cron-refresh-stale-prices] select stale error:", staleErr);
      return jsonResponse({ ok: false, code: "SELECT_FAILED", error: staleErr.message }, 200);
    }

    // Always include currently-flagged items (they need re-check regardless of timestamp)
    const { data: flaggedItems } = await supabase
      .from("catalog_items")
      .select("id")
      .eq("needs_price_review", true)
      .limit(MAX_ITEMS_PER_RUN);

    const idSet = new Set<string>();
    (staleItems || []).forEach((r: any) => idSet.add(r.id));
    (flaggedItems || []).forEach((r: any) => idSet.add(r.id));
    const allIds = Array.from(idSet).slice(0, MAX_ITEMS_PER_RUN);

    if (allIds.length === 0) {
      return jsonResponse({ ok: true, checked: 0, message: "no stale items" });
    }

    // Batch through price-checker
    let totals = { checked: 0, updated: 0, flagged: 0, failed: 0 };
    for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
      const batch = allIds.slice(i, i + BATCH_SIZE);
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/price-checker`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ mode: "items", itemIds: batch }),
        });
        if (res.ok) {
          const j = await res.json().catch(() => ({} as any));
          totals.checked += j.checked || 0;
          totals.updated += j.updated || 0;
          totals.flagged += j.flagged || 0;
          totals.failed += j.failed || 0;
        } else {
          console.warn("[cron-refresh-stale-prices] batch failed", res.status);
          totals.failed += batch.length;
        }
      } catch (e) {
        console.warn("[cron-refresh-stale-prices] batch threw", (e as Error).message);
        totals.failed += batch.length;
      }
    }

    const duration_ms = Date.now() - startedAt;

    // Audit log (best-effort)
    try {
      await supabase.from("system_audit_log").insert({
        actor: "cron",
        action: "cron_refresh_stale_prices",
        target: "catalog_items",
        details: { ...totals, candidates: allIds.length, duration_ms },
      });
    } catch { /* ignore */ }

    console.log("[cron-refresh-stale-prices] done", { candidates: allIds.length, ...totals, duration_ms });
    return jsonResponse({ ok: true, candidates: allIds.length, ...totals, duration_ms });
  } catch (e) {
    console.error("[cron-refresh-stale-prices] fatal", (e as Error).message);
    return jsonResponse({ ok: false, code: "FATAL", error: (e as Error).message }, 200);
  }
});
