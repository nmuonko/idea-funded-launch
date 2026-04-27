// catalog-server-prices
// Batch all-inclusive price resolver for the FROZEN mobile homepage feed.
//
// Contract: POST { items: [{ id, basePriceUsd?, ... }] }
// Returns:  { prices: [{ id, priceUsd, finalPriceUsd, totalPriceUsd, price_usd, basePriceUsd, feesIncluded }] }
//
// CRITICAL: To guarantee parity with /catalog-product (the PDP), this endpoint
// ALWAYS fetches the full row from `catalog_items` by id and feeds the SAME
// shape into the SAME shared `applyAllInclusivePricingToItems` function that
// catalog-product, catalog-home, and catalog-category use. Client-supplied
// basePriceUsd / title are IGNORED when a DB row is found — the DB row is the
// single source of truth, so the homepage card and PDP cannot disagree.
//
// Per frozen-build contract: ALWAYS returns HTTP 200 with JSON, even on errors.

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

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") return ok({ prices: [], error: "method_not_allowed" });

    let payload: { items?: IncomingItem[] } = {};
    try {
      payload = await req.json();
    } catch {
      return ok({ prices: [], error: "invalid_json" });
    }

    const incoming = Array.isArray(payload?.items) ? payload.items : [];
    if (incoming.length === 0) return ok({ prices: [] });

    // Cap batch size to protect CPU budget
    const items = incoming.slice(0, 200);
    const ids = Array.from(new Set(items.map((i) => String(i.id)).filter(Boolean)));

    // ALWAYS fetch DB rows — DB is the single source of truth for parity with PDP
    const dbMap = new Map<string, Record<string, unknown>>();
    if (ids.length > 0) {
      try {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { data, error } = await supabase
          .from("catalog_items")
          .select(
            "id, title, provider, unified_category, category_key, price_usd",
          )
          .in("id", ids);
        if (error) {
          console.warn("[catalog-server-prices] DB fetch error:", error.message);
        } else if (Array.isArray(data)) {
          for (const row of data) dbMap.set(String(row.id), row as Record<string, unknown>);
        }
      } catch (err) {
        console.warn("[catalog-server-prices] DB fetch threw:", err);
      }
    }

    const settings = await loadPricingSettings();

    // Build the array shape that applyAllInclusivePricingToItems expects.
    // Prefer DB row data (canonical) over client-supplied data (untrusted).
    const prepared = items.map((i) => {
      const row = dbMap.get(String(i.id));
      if (row) {
        // DB row found — use canonical data, ignore client basePrice/title
        const basePrice = Number(row.price_usd ?? 0) || 0;
        return {
          __sourceId: i.id,
          __hasRow: true,
          id: row.id,
          title: row.title ?? "",
          provider: row.provider ?? "",
          unified_category: row.unified_category ?? null,
          category_key: row.category_key ?? null,
          price_usd: basePrice,
          priceUsd: basePrice,
        };
      }
      // No DB row — fall back to client-supplied data (best-effort)
      const basePrice = Number(i.basePriceUsd ?? i.priceUsd ?? i.price_usd ?? 0) || 0;
      return {
        __sourceId: i.id,
        __hasRow: false,
        id: i.id,
        title: i.title ?? "",
        provider: i.provider ?? "",
        unified_category: i.unified_category ?? null,
        category_key: i.category_key ?? null,
        price_usd: basePrice,
        priceUsd: basePrice,
      };
    });

    const priced = applyAllInclusivePricingToItems(
      prepared as unknown as Record<string, unknown>[],
      settings,
    );

    const prices = priced.map((p) => {
      const finalPrice = Number(p.price_usd ?? p.priceUsd ?? 0) || 0;
      const basePrice = Number(p.base_price_usd ?? 0) || 0;
      return {
        id: (p as Record<string, unknown>).__sourceId ?? p.id,
        priceUsd: finalPrice,
        finalPriceUsd: finalPrice,
        totalPriceUsd: finalPrice,
        price_usd: finalPrice,
        basePriceUsd: basePrice,
        feesIncluded: true,
        source: (p as Record<string, unknown>).__hasRow ? "db" : "client_fallback",
      };
    });

    console.log(
      `[catalog-server-prices] resolved ${prices.length}/${items.length} (db=${dbMap.size})`,
    );
    return ok({ prices });
  } catch (err) {
    console.error("[catalog-server-prices] fatal:", err);
    return ok({ prices: [], error: "internal_error" });
  }
});
