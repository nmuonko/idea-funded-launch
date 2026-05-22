/**
 * cartLockGate
 *
 * Reusable price-lock validation gate for every checkout entrypoint
 * (web Stripe, web pawaPay, mobile checkout, handoff validate).
 *
 * Contract (returned to caller):
 *   { ok: true }
 *     → all locks active and items available, safe to proceed.
 *
 *   { ok: false, code: 'PRICE_REFRESHED', changedItems, message_en, message_fr }
 *     → at least one lock expired; we silently relocked at the latest price.
 *       Frontend shows a one-click "Continue with updated price" confirmation.
 *
 *   { ok: false, code: 'OUT_OF_STOCK', changedItems, message_en, message_fr }
 *     → at least one item is no longer available from the supplier.
 *
 *   { ok: false, code: 'PRICE_VERIFY_FAILED', changedItems, message_en, message_fr }
 *     → could not verify supplier price for at least one item.
 *
 * All responses MUST be returned with HTTP 200 to preserve the Frozen App
 * API contract; callers wrap this into their own JSON response.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export interface ChangedItem {
  itemId: string;
  title: string | null;
  oldUnitPriceUsd: number | null;
  newUnitPriceUsd: number | null;
  oldTotalUsd: number | null;
  newTotalUsd: number | null;
  status: string;
}

export interface GateResult {
  ok: boolean;
  code?: "PRICE_REFRESHED" | "OUT_OF_STOCK" | "PRICE_VERIFY_FAILED";
  changedItems?: ChangedItem[];
  message_en?: string;
  message_fr?: string;
}

const MSG = {
  refreshed: {
    en: "Your reserved price expired. We refreshed the price before payment.",
    fr: "Votre prix réservé a expiré. Nous avons actualisé le prix avant le paiement.",
  },
  oos: {
    en: "One or more items in your cart are no longer available. Please remove them and continue.",
    fr: "Un ou plusieurs articles de votre panier ne sont plus disponibles. Veuillez les retirer et continuer.",
  },
  verifyFail: {
    en: "We could not verify the current supplier price. Please retry or contact support.",
    fr: "Nous n'avons pas pu vérifier le prix actuel du fournisseur. Veuillez réessayer ou contacter le support.",
  },
};

/**
 * Validate an order's price locks. Calls refresh-cart-locks internally
 * which relocks expired items and reports out-of-stock / verification failure.
 */
export async function runCartLockGate(orderId: string): Promise<GateResult> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/refresh-cart-locks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ orderId }),
    });

    if (!res.ok) {
      // Soft-fail open with verify-fail so checkout shows a friendly retry.
      return {
        ok: false,
        code: "PRICE_VERIFY_FAILED",
        changedItems: [],
        message_en: MSG.verifyFail.en,
        message_fr: MSG.verifyFail.fr,
      };
    }

    const data = await res.json();
    const items: ChangedItem[] = Array.isArray(data?.items) ? data.items : [];
    const oos = items.filter((i) => i.status === "unavailable");
    const refreshed = items.filter((i) => i.status === "refreshed");
    const failed = items.filter((i) => i.status === "verify_failed");

    if (oos.length > 0) {
      return { ok: false, code: "OUT_OF_STOCK", changedItems: oos,
        message_en: MSG.oos.en, message_fr: MSG.oos.fr };
    }
    if (failed.length > 0) {
      return { ok: false, code: "PRICE_VERIFY_FAILED", changedItems: failed,
        message_en: MSG.verifyFail.en, message_fr: MSG.verifyFail.fr };
    }
    if (refreshed.length > 0) {
      return { ok: false, code: "PRICE_REFRESHED", changedItems: refreshed,
        message_en: MSG.refreshed.en, message_fr: MSG.refreshed.fr };
    }
    return { ok: true };
  } catch (e) {
    console.error("[cartLockGate] error", (e as Error).message);
    return {
      ok: false, code: "PRICE_VERIFY_FAILED", changedItems: [],
      message_en: MSG.verifyFail.en, message_fr: MSG.verifyFail.fr,
    };
  }
}
