/**
 * lockedTotals
 *
 * Canonical helper to derive the payable amount from the price-lock columns
 * on order_items. Returns null when any non-vehicle item is missing an
 * active lock — callers must then fall back to their previous total source
 * AND log a warning so we can catch leaks.
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

export async function computeLockedPayableUsd(
  orderId: string,
  client?: any,
): Promise<LockedPayable> {
  let supabase = client;
  if (!supabase) {
    const { createClient } = await import("@supabase/supabase-js");
    supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  }

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
