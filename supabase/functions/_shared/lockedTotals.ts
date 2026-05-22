/**
 * lockedTotals
 *
 * Canonical helper to derive the payable amount from the price-lock columns
 * on order_items.
 *
 * `computeLockedPayableUsd` — pure read, returns null if any non-vehicle lock
 *   is missing.
 *
 * `enforceLockedPayableUsd` — read; if any non-vehicle lock is missing/expired,
 *   synchronously invokes `refresh-cart-locks` and re-reads. If locks still
 *   cannot be created, returns a structured PRICE_LOCK_REQUIRED failure.
 *
 * Vehicles are billed at unit_price_usd * quantity (admin-quoted, never locked).
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export interface LockedPayable {
  usd: number | null;
  allLocked: boolean;
  itemCount: number;
  vehicleCount: number;
  missingLockCount: number;
}

export interface EnforcedLockedPayable {
  ok: boolean;
  usd: number | null;
  itemCount: number;
  vehicleCount: number;
  missingLockCount: number;
  code?: "PRICE_LOCK_REQUIRED" | "EMPTY_CART";
  message_en?: string;
  message_fr?: string;
  refreshAttempted: boolean;
}

const PRICE_LOCK_REQUIRED_MSG = {
  en: "We need to reserve the current price before payment. Please refresh your cart and try again.",
  fr: "Nous devons réserver le prix actuel avant le paiement. Veuillez actualiser votre panier et réessayer.",
};

async function getClient(client?: any) {
  if (client) return client;
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
}

export async function computeLockedPayableUsd(
  orderId: string,
  client?: any,
): Promise<LockedPayable> {
  const supabase = await getClient(client);

  const { data: items, error } = await supabase
    .from("order_items")
    .select(
      "id, quantity, unit_price_usd, is_vehicle, is_saved_for_later, locked_total_price_usd, price_lock_status, price_lock_expires_at",
    )
    .eq("order_id", orderId)
    .eq("is_saved_for_later", false);

  if (error || !items || items.length === 0) {
    return { usd: null, allLocked: false, itemCount: 0, vehicleCount: 0, missingLockCount: 0 };
  }

  const now = Date.now();
  let sum = 0;
  let vehicleCount = 0;
  let missingLockCount = 0;

  for (const it of items) {
    if (it.is_vehicle) {
      vehicleCount++;
      sum += Number(it.unit_price_usd || 0) * Number(it.quantity || 1);
      continue;
    }
    const expiresAt = it.price_lock_expires_at ? new Date(it.price_lock_expires_at).getTime() : 0;
    const active = it.price_lock_status === "active" && expiresAt > now && it.locked_total_price_usd != null;
    if (!active) {
      missingLockCount++;
      continue;
    }
    sum += Number(it.locked_total_price_usd);
  }

  const allLocked = missingLockCount === 0;
  return {
    usd: allLocked ? Math.round(sum * 100) / 100 : null,
    allLocked,
    itemCount: items.length,
    vehicleCount,
    missingLockCount,
  };
}

async function invokeRefreshCartLocks(orderId: string): Promise<void> {
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 25000);
    await fetch(`${SUPABASE_URL}/functions/v1/refresh-cart-locks`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ orderId }),
    });
    clearTimeout(to);
  } catch (e) {
    console.warn("[lockedTotals] refresh-cart-locks failed", (e as Error).message);
  }
}

/**
 * Strictly enforce that every non-vehicle item has a valid active lock.
 * If any are missing, synchronously refresh and re-check. Never falls back
 * to stale order totals — returns PRICE_LOCK_REQUIRED instead.
 */
export async function enforceLockedPayableUsd(
  orderId: string,
  client?: any,
): Promise<EnforcedLockedPayable> {
  const supabase = await getClient(client);

  let snap = await computeLockedPayableUsd(orderId, supabase);

  if (snap.itemCount === 0) {
    return {
      ok: false, usd: null, itemCount: 0, vehicleCount: 0, missingLockCount: 0,
      code: "EMPTY_CART",
      message_en: "Your cart is empty.",
      message_fr: "Votre panier est vide.",
      refreshAttempted: false,
    };
  }

  let refreshAttempted = false;
  if (!snap.allLocked) {
    refreshAttempted = true;
    console.warn("[lockedTotals] missing locks, forcing refresh", {
      orderId, missing: snap.missingLockCount, items: snap.itemCount,
    });
    await invokeRefreshCartLocks(orderId);
    snap = await computeLockedPayableUsd(orderId, supabase);
  }

  if (!snap.allLocked || snap.usd == null || snap.usd <= 0) {
    return {
      ok: false, usd: null,
      itemCount: snap.itemCount,
      vehicleCount: snap.vehicleCount,
      missingLockCount: snap.missingLockCount,
      code: "PRICE_LOCK_REQUIRED",
      message_en: PRICE_LOCK_REQUIRED_MSG.en,
      message_fr: PRICE_LOCK_REQUIRED_MSG.fr,
      refreshAttempted,
    };
  }

  return {
    ok: true, usd: snap.usd,
    itemCount: snap.itemCount,
    vehicleCount: snap.vehicleCount,
    missingLockCount: 0,
    refreshAttempted,
  };
}
