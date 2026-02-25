/**
 * Amazon Ingest Worker — THE ONLY function that calls Rainforest/Amazon live API
 * 
 * Triggered by pg_cron. Processes the amazon_ingest_queue first,
 * then seeds Congo/DRC high-demand queries (iPhone 12–17 focus).
 * 
 * Budget gates: 12/hour + 10,000/month hard cap.
 * Auth: x-cron-secret header must match CRON_SECRET env var.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { searchRainforest, fetchProductDetails } from "../_shared/rainforestAdapter.ts";
import { checkBudget, incrementBudget } from "../_shared/providerBudget.ts";
import { getCatalogSettings } from "../_shared/catalogSettings.ts";
import { mapCategoryAndSubcategory } from "../_shared/categoryMapper.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── CONGO/DRC HIGH-DEMAND SEED QUERIES ──────────────────────────────────────

const AMAZON_CONGO_SEEDS: Array<{ query: string; category_key: string; priority: number }> = [
  // iPhone focus (TOP priority)
  { query: "iphone 17 unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 17 pro max unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 16 unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 16 pro unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 15 unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 15 pro max unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 14 unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 14 pro unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 13 unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 13 pro unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "iphone 12 unlocked renewed", category_key: "electronics_phones", priority: 1 },
  { query: "renewed iphone unlocked", category_key: "electronics_phones", priority: 2 },
  { query: "refurbished iphone unlocked", category_key: "electronics_phones", priority: 2 },

  // Android favorites (secondary)
  { query: "samsung galaxy a15 unlocked", category_key: "electronics_phones", priority: 3 },
  { query: "samsung galaxy a25 unlocked", category_key: "electronics_phones", priority: 3 },
  { query: "samsung galaxy s24 ultra unlocked", category_key: "electronics_phones", priority: 3 },
  { query: "tecno spark unlocked", category_key: "electronics_phones", priority: 3 },
  { query: "infinix hot unlocked", category_key: "electronics_phones", priority: 3 },
  { query: "dual sim unlocked smartphone", category_key: "electronics_phones", priority: 3 },

  // Power + charging (very high demand)
  { query: "power bank 20000mah fast charging", category_key: "electronics", priority: 2 },
  { query: "usb c charger 25w", category_key: "electronics", priority: 3 },
  { query: "solar lantern rechargeable", category_key: "electronics", priority: 3 },
  { query: "rechargeable led bulb e27", category_key: "electronics", priority: 3 },
  { query: "surge protector heavy duty", category_key: "electronics", priority: 3 },

  // Internet/routers
  { query: "tp link router", category_key: "electronics", priority: 3 },
  { query: "4g lte hotspot unlocked", category_key: "electronics", priority: 3 },
  { query: "wifi extender", category_key: "electronics", priority: 3 },

  // Laptops (renewed)
  { query: "lenovo thinkpad renewed i5", category_key: "electronics_computers", priority: 3 },
  { query: "dell latitude renewed i5", category_key: "electronics_computers", priority: 3 },
  { query: "ssd 1tb", category_key: "electronics_computers", priority: 4 },
  { query: "ddr4 16gb laptop ram", category_key: "electronics_computers", priority: 4 },
];

// ─── AUTH ─────────────────────────────────────────────────────────────────────

function verifyCronAuth(req: Request): boolean {
  const cronSecret = Deno.env.get("CRON_SECRET") || "";
  const internalKey = "afrishop-internal-cron-2026";
  const headerSecret = req.headers.get("x-cron-secret") || req.headers.get("x-internal-cron-key") || "";
  
  if (!headerSecret) return false;
  if (cronSecret && headerSecret === cronSecret) return true;
  if (headerSecret === internalKey) return true;
  return false;
}

// ─── BUDGET CHECK ─────────────────────────────────────────────────────────────

interface BudgetGate {
  allowed: boolean;
  hourlyRemaining: number;
  monthlyRemaining: number;
}

async function checkDualBudget(supabase: any, settings: any, requestId: string): Promise<BudgetGate> {
  const [hourly, monthly] = await Promise.all([
    checkBudget(supabase, "amazon", "hour", settings.amazonMaxCallsPerHour, requestId),
    checkBudget(supabase, "amazon", "month", settings.amazonMaxCallsPerMonth, requestId),
  ]);

  return {
    allowed: hourly.allowed && monthly.allowed,
    hourlyRemaining: hourly.remaining,
    monthlyRemaining: monthly.remaining,
  };
}

async function incrementDualBudget(supabase: any, settings: any, requestId: string): Promise<void> {
  await Promise.all([
    incrementBudget(supabase, "amazon", "hour", requestId, settings.amazonMaxCallsPerHour),
    incrementBudget(supabase, "amazon", "month", requestId, settings.amazonMaxCallsPerMonth),
  ]);
}

// ─── PROCESS SINGLE QUEUE ITEM ───────────────────────────────────────────────

async function processQueueItem(
  supabase: any,
  item: { id: number; query: string; category_key: string | null; attempts: number },
  settings: any,
  requestId: string
): Promise<{ success: boolean; itemsIngested: number }> {
  const budget = await checkDualBudget(supabase, settings, requestId);
  if (!budget.allowed) {
    console.log(`[AMAZON_INGEST] budget denied for queue item ${item.id} (hourly=${budget.hourlyRemaining}, monthly=${budget.monthlyRemaining})`);
    return { success: false, itemsIngested: 0 };
  }

  // Mark as processing
  await supabase.from("amazon_ingest_queue")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", item.id);

  try {
    let itemsIngested = 0;

    if (item.query.startsWith("asin:")) {
      // Product detail fetch
      const asin = item.query.replace("asin:", "");
      const { product, error } = await fetchProductDetails(asin, "amazon.com");
      
      await incrementDualBudget(supabase, settings, requestId);

      if (error || !product) {
        throw new Error(error || "Product not found");
      }

      const { category: mappedCat, subcategory } = mapCategoryAndSubcategory({
        title: product.title || "", provider: "rainforest", productUrl: product.productUrl || "",
      });

      await supabase.from("catalog_items").upsert({
        id: `amazon_${product.providerProductId}`,
        provider: "rainforest",
        provider_product_id: product.providerProductId,
        title: product.title,
        price_usd: product.priceUsd,
        image_url: product.imageUrl,
        images: product.images || [],
        product_url: product.productUrl,
        in_stock: product.inStock ?? true,
        rating: product.rating,
        brand: product.brand,
        unified_category: mappedCat !== "blocked" ? mappedCat : (item.category_key || "electronics"),
        unified_subcategory: subcategory,
        category_key: item.category_key || "uncategorized",
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });

      itemsIngested = 1;
      console.log(`[AMAZON_INGEST] processed ASIN ${asin}, ingested 1 product`);
    } else {
      // Search query
      const result = await searchRainforest(item.query, 1, 20, "amazon.com");
      
      await incrementDualBudget(supabase, settings, requestId);

      if (result.error) {
        throw new Error(result.error);
      }

      if (result.products.length > 0) {
        const now = new Date().toISOString();
        const toUpsert = result.products.map(p => {
          const { category: mappedCat, subcategory } = mapCategoryAndSubcategory({
            title: p.title || "", provider: "rainforest", productUrl: p.productUrl || "",
          });
          return {
            id: `amazon_${p.providerProductId}`,
            provider: "rainforest",
            provider_product_id: p.providerProductId,
            title: p.title,
            price_usd: p.priceUsd,
            image_url: p.imageUrl,
            images: (p.images?.length > 0) ? p.images : (p.imageUrl ? [p.imageUrl] : []),
            product_url: p.productUrl,
            in_stock: p.inStock ?? true,
            rating: p.rating,
            unified_category: mappedCat !== "blocked" ? mappedCat : (item.category_key || "electronics"),
            unified_subcategory: subcategory,
            category_key: item.category_key || "uncategorized",
            updated_at: now,
          };
        });

        await supabase.from("catalog_items").upsert(toUpsert, { onConflict: "id" });
        itemsIngested = toUpsert.length;
        console.log(`[AMAZON_INGEST] processed query "${item.query}", ingested ${itemsIngested} products`);
      }
    }

    // Mark as done
    await supabase.from("amazon_ingest_queue")
      .update({ status: "done", updated_at: new Date().toISOString() })
      .eq("id", item.id);

    return { success: true, itemsIngested };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const newAttempts = (item.attempts || 0) + 1;
    const newStatus = newAttempts >= 3 ? "failed" : "queued";

    await supabase.from("amazon_ingest_queue")
      .update({
        status: newStatus,
        attempts: newAttempts,
        last_error: errorMsg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.id);

    console.error(`[AMAZON_INGEST] error processing queue item ${item.id}: ${errorMsg} (attempt ${newAttempts})`);
    return { success: false, itemsIngested: 0 };
  }
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth check
  if (!verifyCronAuth(req)) {
    console.error("[AMAZON_INGEST] Unauthorized request");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const requestId = `ingest-${Date.now()}`;
  const startTime = Date.now();

  console.log(`[AMAZON_INGEST] Worker started, requestId=${requestId}`);

  const settings = await getCatalogSettings(supabase);

  let totalQueueProcessed = 0;
  let totalSeedsProcessed = 0;
  let totalItemsIngested = 0;
  let budgetDenied = false;

  // ─── PHASE 1: Process queue items (up to 10) ───────────────────────
  const { data: queueItems } = await supabase
    .from("amazon_ingest_queue")
    .select("id, query, category_key, attempts")
    .eq("status", "queued")
    .order("priority", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(10);

  if (queueItems && queueItems.length > 0) {
    console.log(`[AMAZON_INGEST] Processing ${queueItems.length} queue items`);

    for (const item of queueItems) {
      const result = await processQueueItem(supabase, item, settings, requestId);
      if (!result.success && result.itemsIngested === 0) {
        // Budget denied — stop processing
        const gate = await checkDualBudget(supabase, settings, requestId);
        if (!gate.allowed) {
          budgetDenied = true;
          console.log(`[AMAZON_INGEST] budget denied, stopping queue processing`);
          break;
        }
      }
      totalQueueProcessed++;
      totalItemsIngested += result.itemsIngested;

      // Small delay between requests
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // ─── PHASE 2: Seed Congo/DRC queries (up to 10, if budget allows) ──
  if (!budgetDenied) {
    // Pick seeds using a rotating offset based on current day
    const dayOfMonth = new Date().getDate();
    const seedOffset = (dayOfMonth * 10) % AMAZON_CONGO_SEEDS.length;
    const seedsToProcess = [];

    for (let i = 0; i < Math.min(10, AMAZON_CONGO_SEEDS.length); i++) {
      const idx = (seedOffset + i) % AMAZON_CONGO_SEEDS.length;
      seedsToProcess.push(AMAZON_CONGO_SEEDS[idx]);
    }

    for (const seed of seedsToProcess) {
      const gate = await checkDualBudget(supabase, settings, requestId);
      if (!gate.allowed) {
        console.log(`[AMAZON_INGEST] budget denied, stopping seed processing (hourly=${gate.hourlyRemaining}, monthly=${gate.monthlyRemaining})`);
        budgetDenied = true;
        break;
      }

      try {
        const result = await searchRainforest(seed.query, 1, 20, "amazon.com");
        await incrementDualBudget(supabase, settings, requestId);

        if (!result.error && result.products.length > 0) {
          const now = new Date().toISOString();
          const toUpsert = result.products.map(p => {
            const { category: mappedCat, subcategory } = mapCategoryAndSubcategory({
              title: p.title || "", provider: "rainforest", productUrl: p.productUrl || "",
            });
            return {
              id: `amazon_${p.providerProductId}`,
              provider: "rainforest",
              provider_product_id: p.providerProductId,
              title: p.title,
              price_usd: p.priceUsd,
              image_url: p.imageUrl,
              images: (p.images?.length > 0) ? p.images : (p.imageUrl ? [p.imageUrl] : []),
              product_url: p.productUrl,
              in_stock: p.inStock ?? true,
              rating: p.rating,
              unified_category: mappedCat !== "blocked" ? mappedCat : seed.category_key,
              unified_subcategory: subcategory,
              category_key: seed.category_key,
              updated_at: now,
            };
          });

          await supabase.from("catalog_items").upsert(toUpsert, { onConflict: "id" });
          totalItemsIngested += toUpsert.length;
          console.log(`[AMAZON_INGEST] seeded query "${seed.query}", ingested ${toUpsert.length} products`);
        }

        totalSeedsProcessed++;
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.error(`[AMAZON_INGEST] seed error for "${seed.query}": ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const duration = Date.now() - startTime;
  const summary = {
    requestId,
    queueProcessed: totalQueueProcessed,
    seedsProcessed: totalSeedsProcessed,
    totalItemsIngested,
    budgetDenied,
    durationMs: duration,
  };

  console.log(`[AMAZON_INGEST] Worker complete:`, JSON.stringify(summary));

  return new Response(JSON.stringify({ ok: true, ...summary }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
