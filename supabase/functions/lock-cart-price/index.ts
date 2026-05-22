/**
 * lock-cart-price
 *
 * Verifies the live supplier price for a single order_item, computes the
 * all-inclusive AfriShop price, and locks it on the cart line for a TTL
 * (30–60 min by tier, admin configurable).
 *
 * Request: { itemId: string, force?: boolean }
 * Response (HTTP 200 always — Frozen App API contract):
 *   ok: true → canonical locked payload
 *   ok: false → { code, message_en, message_fr }
 */

import { createClient } from "@supabase/supabase-js";
import {
  classifyTier,
  isElectronicsTitle,
  lockMinutesForTier,
  loadPriceValidationSettings,
  inferMarketplace,
} from "../_shared/refreshTiers.ts";
import {
  loadPricingSettings,
  computeAllInclusivePrice,
} from "../_shared/allInclusivePricing.ts";

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

const MSG_VERIFY_FAIL = {
  en: "We need to verify the current supplier price before reserving this item. Please try again.",
  fr: "Nous devons vérifier le prix actuel de cet article avant de le réserver. Veuillez réessayer.",
};
const MSG_OOS = {
  en: "This item is no longer available from the supplier.",
  fr: "Cet article n'est plus disponible chez le fournisseur.",
};
const MSG_OK_EN = "Price reserved for {min} minutes.";
const MSG_OK_FR = "Prix réservé pendant {min} minutes.";

interface ExtractResult {
  price: number | null;
  availability: "available" | "unavailable" | "unknown";
  error?: string;
}

async function extractLivePrice(url: string): Promise<ExtractResult> {
  try {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(`${SUPABASE_URL}/functions/v1/extract-price`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ url }),
    });
    clearTimeout(to);
    if (!res.ok) return { price: null, availability: "unknown", error: `http_${res.status}` };
    const d = await res.json();
    const p = Number(d?.price ?? d?.price_usd ?? d?.basePrice ?? 0);
    if (!p || !isFinite(p) || p <= 0) {
      return { price: null, availability: "unknown", error: "no_price" };
    }
    return { price: p, availability: "available" };
  } catch (e) {
    return { price: null, availability: "unknown", error: (e as Error).message.slice(0, 120) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const itemId: string = body?.itemId || body?.item_id || "";
  if (!itemId) {
    return json({ ok: false, code: "BAD_REQUEST", message_en: "itemId required", message_fr: "itemId requis" });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: item, error } = await supabase
    .from("order_items")
    .select("id, order_id, title, product_url, base_price_usd, unit_price_usd, quantity, is_vehicle, price_lock_expires_at, locked_unit_price_usd, locked_source_price_usd")
    .eq("id", itemId)
    .maybeSingle();

  if (error || !item) {
    return json({ ok: false, code: "NOT_FOUND", message_en: "Item not found", message_fr: "Article introuvable" });
  }

  // Vehicles: skip lock entirely (admin-quoted, not auto-refreshed)
  if (item.is_vehicle) {
    return json({
      ok: true,
      lockedUnitPriceUsd: item.unit_price_usd,
      lockedTotalPriceUsd: Number(item.unit_price_usd) * Number(item.quantity || 1),
      priceLockExpiresAt: null,
      priceLockStatus: "none",
      message_en: "Vehicle pricing — no lock.",
      message_fr: "Tarification véhicule — pas de réservation.",
    });
  }

  if (!item.product_url) {
    return json({ ok: false, code: "PRICE_VERIFY_FAILED",
      message_en: MSG_VERIFY_FAIL.en, message_fr: MSG_VERIFY_FAIL.fr });
  }

  // 1. Verify live source price
  const live = await extractLivePrice(item.product_url);
  if (live.availability === "unavailable") {
    await supabase.from("order_items")
      .update({ price_lock_status: "unavailable", source_availability: "unavailable" })
      .eq("id", itemId);
    return json({ ok: false, code: "OUT_OF_STOCK",
      message_en: MSG_OOS.en, message_fr: MSG_OOS.fr });
  }
  if (!live.price) {
    return json({ ok: false, code: "PRICE_VERIFY_FAILED",
      message_en: MSG_VERIFY_FAIL.en, message_fr: MSG_VERIFY_FAIL.fr });
  }

  // 2. Compute all-inclusive
  const [pricing, settings] = await Promise.all([
    loadPricingSettings(),
    loadPriceValidationSettings(SUPABASE_URL, SERVICE_ROLE_KEY),
  ]);
  const unitAllInclusive = computeAllInclusivePrice(live.price, pricing, { title: item.title });
  const qty = Number(item.quantity || 1);
  const totalLocked = unitAllInclusive * qty;

  // 3. Tier + lock duration
  const tier = classifyTier({
    title: item.title,
    isVehicle: false,
    inCart: true,
  });
  const lockMin = lockMinutesForTier(tier, settings);
  const now = new Date();
  const expires = new Date(now.getTime() + lockMin * 60_000);
  const marketplace = inferMarketplace(item.product_url);

  // 4. Persist
  await supabase.from("order_items").update({
    locked_unit_price_usd: unitAllInclusive,
    locked_total_price_usd: totalLocked,
    price_locked_at: now.toISOString(),
    price_lock_expires_at: expires.toISOString(),
    locked_source_price_usd: live.price,
    locked_source_price_checked_at: now.toISOString(),
    price_lock_status: "active",
    source_marketplace: marketplace,
    source_availability: "available",
  }).eq("id", itemId);

  return json({
    ok: true,
    lockedUnitPriceUsd: unitAllInclusive,
    lockedTotalPriceUsd: totalLocked,
    priceLockExpiresAt: expires.toISOString(),
    priceLockStatus: "active",
    sourceMarketplace: marketplace,
    message_en: MSG_OK_EN.replace("{min}", String(lockMin)),
    message_fr: MSG_OK_FR.replace("{min}", String(lockMin)),
  });
});
