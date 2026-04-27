// catalog-server-prices
// Batch all-inclusive price resolver for the mobile homepage feed.
//
// The frozen RN app POSTs `{ items: [{ id, basePriceUsd, ... }] }` and expects
// `{ prices: [{ id, priceUsd, finalPriceUsd, totalPriceUsd, price_usd }] }`
// with the SAME all-inclusive number that catalog-home / catalog-product return.
//
// Uses the shared allInclusivePricing module so every catalog endpoint agrees.
//
// Per frozen-build contract: ALWAYS returns HTTP 200 with JSON, even on errors,
// to prevent the mobile app from crashing on null responses.

import { createClient } from "@supabase/supabase-js";
import {
  loadPricingSettings,
  applyAllInclusivePricingToItems,
} from "../_shared/allInclusivePricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface IncomingItem {
  id: string;
  basePriceUsd?: number | null;
  priceUsd?: number | null;
  price_usd?: number | null;
  title?: string | null;
  provider?: string | null;
  unified_category?: string | null;
  category_key?: string | null;
}

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Frozen-app contract: never return non-200; always JSON.
  try {
    if (req.method !== "POST") {
      return ok({ prices: [], error: "method_not_allowed" });
    }

    let payload: { items?: IncomingItem[] } = {};
    try {
      payload = await req.json();
    } catch {
      return ok({ prices: [], error: "invalid_json" });
    }

    const incoming = Array.isArray(payload?.items) ? payload.items : [];
    if (incoming.length === 0) return ok({ prices: [] });

    // Cap to protect CPU budget (mobile homepage rarely sends >50)
    const items = incoming.slice(0, 200);

    // We may need to enrich items missing basePriceUsd / title / provider
    // (the RN app sometimes sends just { id, basePriceUsd }) — fetch from DB
    // to ensure accurate category-based shipping.
    const idsNeedingEnrich = items
      .filter((i) => !i.title || !i.provider)
      .map((i) => i.id)
      .filter(Boolean);

    let enrichMap = new Map<string, Record<string, unknown>>();
    if (idsNeedingEnrich.length > 0) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { data } = await supabase
          .from("catalog_items")
          .select("id, title, provider, unified_category, category_key, price_usd")
          .in("id", idsNeedingEnrich);
        if (Array.isArray(data)) {
          for (const row of data) enrichMap.set(String(row.id), row as Record<string, unknown>);
        }
      } catch (err) {
        console.warn("[catalog-server-prices] enrich failed:", err);
      }
    }

    const settings = await loadPricingSettings();

    // Build the array shape that applyAllInclusivePricingToItems expects.
    const prepared = items.map((i) => {
      const enriched = enrichMap.get(String(i.id)) || {};
      const basePrice =
        Number(i.basePriceUsd ?? i.priceUsd ?? i.price_usd ?? enriched.price_usd ?? 0) || 0;
      return {
        id: i.id,
        title: (i.title ?? enriched.title ?? "") as string,
        provider: (i.provider ?? enriched.provider ?? "") as string,
        unified_category: i.unified_category ?? enriched.unified_category ?? null,
        category_key: i.category_key ?? enriched.category_key ?? null,
        price_usd: basePrice,
        priceUsd: basePrice,
      };
    });

    const priced = applyAllInclusivePricingToItems(prepared as Record<string, unknown>[], settings);

    const prices = priced.map((p) => {
      const finalPrice = Number(p.price_usd ?? p.priceUsd ?? 0) || 0;
      return {
        id: p.id,
        priceUsd: finalPrice,
        finalPriceUsd: finalPrice,
        totalPriceUsd: finalPrice,
        price_usd: finalPrice,
        basePriceUsd: Number(p.base_price_usd ?? 0) || 0,
        feesIncluded: true,
      };
    });

    return ok({ prices });
  } catch (err) {
    console.error("[catalog-server-prices] fatal:", err);
    return ok({ prices: [], error: "internal_error" });
  }
});
