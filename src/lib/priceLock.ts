/**
 * Price lock helpers — frontend wrappers around the backend lock/refresh
 * endpoints. The backend is the single source of truth; the frontend
 * never recomputes prices.
 */
import { supabase } from "@/integrations/supabase/client";

export interface LockLine {
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

export interface RefreshLocksResult {
  ok: boolean;
  items: LockLine[];
  expiredCount: number;
  unavailableCount: number;
  verifyFailedCount: number;
}

export async function refreshCartLocks(orderId: string): Promise<RefreshLocksResult | null> {
  try {
    const { data, error } = await supabase.functions.invoke("refresh-cart-locks", {
      body: { orderId },
    });
    if (error) return null;
    return data as RefreshLocksResult;
  } catch {
    return null;
  }
}

export async function lockCartPrice(itemId: string): Promise<any | null> {
  try {
    const { data, error } = await supabase.functions.invoke("lock-cart-price", {
      body: { itemId },
    });
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}
