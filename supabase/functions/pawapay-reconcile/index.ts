/**
 * pawapay-reconcile Edge Function
 *
 * Background safety net for missed pawaPay callbacks. Polls /deposits/{id}
 * for any payments that are still `pending` and older than 2 minutes,
 * then updates DB / finalizes the order accordingly.
 *
 * Auth: requires x-cron-secret header OR service_role key.
 * Schedule: invoked every 2 minutes via pg_cron + net.http_post.
 */

import { createClient } from "@supabase/supabase-js";
import { getPawaPayConfig, verifyDeposit } from "../_shared/pawapayAdapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MAX_BATCH = 25;
const MIN_AGE_MINUTES = 2;
const MAX_AGE_HOURS = 24; // ignore very old/already-expired

function authorize(req: Request): boolean {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (cronSecret && headerSecret && headerSecret === cronSecret) return true;

  const auth = req.headers.get("authorization") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (serviceKey && auth === `Bearer ${serviceKey}`) return true;

  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (anonKey && auth === `Bearer ${anonKey}`) return true;

  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!authorize(req)) {
    return new Response(
      JSON.stringify({ ok: false, error: "unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const cutoffOld = new Date(Date.now() - MIN_AGE_MINUTES * 60 * 1000).toISOString();
  const cutoffMax = new Date(Date.now() - MAX_AGE_HOURS * 3600 * 1000).toISOString();

  // Pull pending pawapay payments stuck without a callback
  const { data: pending, error } = await admin
    .from("payments")
    .select("id, order_id, provider_deposit_id, status, created_at")
    .eq("provider_key", "pawapay")
    .eq("status", "pending")
    .not("provider_deposit_id", "is", null)
    .lt("created_at", cutoffOld)
    .gt("created_at", cutoffMax)
    .order("created_at", { ascending: true })
    .limit(MAX_BATCH);

  if (error) {
    console.error("[pawapay-reconcile] DB query failed:", error.message);
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (!pending || pending.length === 0) {
    return new Response(
      JSON.stringify({ ok: true, checked: 0, updated: 0 }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let config;
  try {
    config = getPawaPayConfig();
  } catch (e: any) {
    console.error("[pawapay-reconcile] config missing:", e.message);
    return new Response(
      JSON.stringify({ ok: false, error: "PAWAPAY_CONFIG_MISSING" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let updated = 0;
  let succeeded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const p of pending) {
    try {
      const result = await verifyDeposit(config, p.provider_deposit_id!);
      if (!result.success || result.status === "pending") continue;

      const newStatus = result.status; // 'succeeded' | 'failed'

      const { error: updErr } = await admin
        .from("payments")
        .update({
          status: newStatus,
          provider_transaction_id: result.provider_transaction_id ?? null,
          paid_at: result.paid_at ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", p.id);

      if (updErr) {
        errors.push(`payment ${p.id}: ${updErr.message}`);
        continue;
      }

      updated++;

      if (newStatus === "succeeded") {
        succeeded++;
        const { error: rpcErr } = await admin.rpc("finalize_paid_order", {
          p_order_id: p.order_id,
          p_payment_ref: p.provider_deposit_id,
          p_operator_ref: result.provider_transaction_id ?? p.provider_deposit_id,
          p_trace_id: `reconcile-${p.id.slice(0, 8)}`,
        });
        if (rpcErr) {
          console.error(`[pawapay-reconcile] finalize_paid_order failed for ${p.order_id}:`, rpcErr.message);
          errors.push(`finalize ${p.order_id}: ${rpcErr.message}`);
        }
      } else {
        failed++;
      }

      // Log a synthetic event so we have an audit trail for missed callbacks
      await admin.from("payment_events").insert({
        event_id: `${p.provider_deposit_id}_${newStatus.toUpperCase()}_RECONCILE`,
        event_type: "reconcile_polled",
        provider_key: "pawapay",
        payment_id: p.id,
        payload: {
          depositId: p.provider_deposit_id,
          status: newStatus.toUpperCase(),
          source: "pawapay-reconcile",
        },
      }).select().maybeSingle().catch(() => null);
    } catch (e: any) {
      console.error("[pawapay-reconcile] verify error:", e.message);
      errors.push(e.message);
    }
  }

  console.log("[pawapay-reconcile] done", {
    checked: pending.length,
    updated,
    succeeded,
    failed,
    error_count: errors.length,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      checked: pending.length,
      updated,
      succeeded,
      failed,
      errors: errors.slice(0, 5),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
