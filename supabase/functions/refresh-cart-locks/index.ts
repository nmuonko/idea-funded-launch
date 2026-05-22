/**
 * refresh-cart-locks
 *
 * For every item in an order: if its lock is still active, return it as-is.
 * If expired, call lock-cart-price to relock at the latest verified price.
 *
 * Returns HTTP 200 with a list of canonical locked-line payloads plus
 * per-item status: active | refreshed | unavailable | verify_failed.
 *
 * Called by cart page on open, and by every checkout gate via cartLockGate.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface LockLine {
  itemId: string;
  title: string | null;
  status: "active" | "refreshed" | "unavailable" | "verify_failed";
  lockedUnitPriceUsd: number | null;
  lockedTotalPriceUsd: number | null;
  priceLockExpiresAt: string | null;
  oldUnitPriceUsd: number | null;
  oldTotalUsd: number | null;
  newUnitPriceUsd: number | null;
  newTotalUsd: number | null;
}

async function relock(itemId: string): Promise<any> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/lock-cart-price`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ itemId }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, code: "PRICE_VERIFY_FAILED" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const orderId: string = body?.orderId || body?.order_id || "";
  if (!orderId) return json({ ok: false, error: "orderId required", items: [] });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: items, error } = await supabase
    .from("order_items")
    .select("id, title, quantity, is_vehicle, is_saved_for_later, locked_unit_price_usd, locked_total_price_usd, price_lock_expires_at, price_lock_status")
    .eq("order_id", orderId)
    .eq("is_saved_for_later", false);

  if (error) return json({ ok: false, error: error.message, items: [] });

  const now = Date.now();
  const out: LockLine[] = [];

  for (const it of items || []) {
    if (it.is_vehicle) {
      out.push({
        itemId: it.id, title: it.title, status: "active",
        lockedUnitPriceUsd: null, lockedTotalPriceUsd: null,
        priceLockExpiresAt: null,
        oldUnitPriceUsd: null, oldTotalUsd: null,
        newUnitPriceUsd: null, newTotalUsd: null,
      });
      continue;
    }

    const expiresAt = it.price_lock_expires_at ? new Date(it.price_lock_expires_at).getTime() : 0;
    const active = it.price_lock_status === "active" && expiresAt > now;

    if (active) {
      out.push({
        itemId: it.id, title: it.title, status: "active",
        lockedUnitPriceUsd: Number(it.locked_unit_price_usd),
        lockedTotalPriceUsd: Number(it.locked_total_price_usd),
        priceLockExpiresAt: it.price_lock_expires_at,
        oldUnitPriceUsd: null, oldTotalUsd: null,
        newUnitPriceUsd: null, newTotalUsd: null,
      });
      continue;
    }

    const oldUnit = it.locked_unit_price_usd != null ? Number(it.locked_unit_price_usd) : null;
    const oldTotal = it.locked_total_price_usd != null ? Number(it.locked_total_price_usd) : null;
    const res = await relock(it.id);

    if (res?.code === "OUT_OF_STOCK") {
      out.push({
        itemId: it.id, title: it.title, status: "unavailable",
        lockedUnitPriceUsd: oldUnit, lockedTotalPriceUsd: oldTotal,
        priceLockExpiresAt: null,
        oldUnitPriceUsd: oldUnit, oldTotalUsd: oldTotal,
        newUnitPriceUsd: null, newTotalUsd: null,
      });
    } else if (!res?.ok) {
      out.push({
        itemId: it.id, title: it.title, status: "verify_failed",
        lockedUnitPriceUsd: oldUnit, lockedTotalPriceUsd: oldTotal,
        priceLockExpiresAt: null,
        oldUnitPriceUsd: oldUnit, oldTotalUsd: oldTotal,
        newUnitPriceUsd: null, newTotalUsd: null,
      });
    } else {
      const newUnit = Number(res.lockedUnitPriceUsd);
      const newTotal = Number(res.lockedTotalPriceUsd);
      const changed = oldUnit != null && Math.abs(newUnit - oldUnit) > 0.01;
      out.push({
        itemId: it.id, title: it.title,
        status: changed ? "refreshed" : "active",
        lockedUnitPriceUsd: newUnit, lockedTotalPriceUsd: newTotal,
        priceLockExpiresAt: res.priceLockExpiresAt,
        oldUnitPriceUsd: oldUnit, oldTotalUsd: oldTotal,
        newUnitPriceUsd: newUnit, newTotalUsd: newTotal,
      });
    }
  }

  return json({
    ok: true,
    items: out,
    expiredCount: out.filter((i) => i.status === "refreshed").length,
    unavailableCount: out.filter((i) => i.status === "unavailable").length,
    verifyFailedCount: out.filter((i) => i.status === "verify_failed").length,
  });
});
