/**
 * catalog-prewarm-worker
 * 
 * Background worker for home feed prewarming
 * 
 * Processes sections one at a time with progress updates:
 * 1. Receives jobId from catalog-prewarm-home
 * 2. Processes each section sequentially
 * 3. Updates prewarm_jobs.sections_completed after each section
 * 4. Marks job as completed/failed when done
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { searchRainforest } from "../_shared/rainforestAdapter.ts";
import { searchEbay, NormalizedItem } from "../_shared/ebayBrowseSearch.ts";
import { getAmazonLiveSettings } from "../_shared/amazonLivePolicy.ts";
import { checkBudget, incrementBudget } from "../_shared/providerBudget.ts";
import { getCatalogSettings } from "../_shared/catalogSettings.ts";
import { isDisallowedItem } from "../_shared/contentBlocker.ts";
import { isAllowedMotorListing } from "../_shared/motorsFilter.ts";
import { normalizeAndValidateImageUrl } from "../_shared/imageValidation.ts";
import {
  buildHomeSectionMixedCacheKey,
  buildHomeSectionAmazonCacheKey,
  buildHomeSectionEbayCacheKey,
  calculateCacheExpiry,
} from "../_shared/homeRotation.ts";
import {
  mixProviderItems,
  ProviderItem,
  getInitialCursor,
} from "../_shared/providerMixer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Home sections to prewarm
const HOME_PREWARM_SECTIONS = [
  { 
    key: "phones", 
    categoryKey: "electronics_phones", 
    parentTab: "electronics",
    subtabKey: "phones",
    isVehicle: false,
    minPrice: 0,
    amazonQueries: ["iphone 15", "samsung galaxy s24", "google pixel 8"],
    ebayCategory: "9355",
    ebayQueries: ["iphone", "samsung galaxy", "google pixel"],
  },
  { 
    key: "vehicles", 
    categoryKey: "vehicles_cars_trucks", 
    parentTab: "vehicles",
    subtabKey: "cars_trucks",
    isVehicle: true,
    minPrice: 1500,
    amazonQueries: ["car accessories", "car parts"],
    ebayCategory: "6001",
    ebayQueries: ["used car", "toyota", "honda"],
  },
  { 
    key: "gaming", 
    categoryKey: "electronics_gaming", 
    parentTab: "electronics",
    subtabKey: "gaming",
    isVehicle: false,
    minPrice: 0,
    amazonQueries: ["ps5 console", "xbox series x", "nintendo switch"],
    ebayCategory: "1249",
    ebayQueries: ["ps5", "xbox", "nintendo switch"],
  },
  { 
    key: "computers", 
    categoryKey: "electronics_computers", 
    parentTab: "electronics",
    subtabKey: "computers",
    isVehicle: false,
    minPrice: 0,
    amazonQueries: ["laptop", "macbook", "gaming laptop"],
    ebayCategory: "58058",
    ebayQueries: ["laptop", "macbook pro", "gaming laptop"],
  },
  { 
    key: "clothing", 
    categoryKey: "clothing_shoes_accessories", 
    parentTab: "clothing_shoes_accessories",
    subtabKey: null,
    isVehicle: false,
    minPrice: 0,
    amazonQueries: ["sneakers men", "running shoes", "hoodie"],
    ebayCategory: "63889",
    ebayQueries: ["nike shoes", "adidas sneakers", "hoodie"],
  },
  { 
    key: "home_garden", 
    categoryKey: "home_garden", 
    parentTab: "home_garden",
    subtabKey: null,
    isVehicle: false,
    minPrice: 0,
    amazonQueries: ["robot vacuum", "air fryer", "blender"],
    ebayCategory: "11700",
    ebayQueries: ["vacuum cleaner", "air fryer", "kitchen appliance"],
  },
  { 
    key: "refurbished", 
    categoryKey: "refurbished", 
    parentTab: "refurbished",
    subtabKey: null,
    isVehicle: false,
    minPrice: 0,
    amazonQueries: ["refurbished iphone", "refurbished laptop"],
    ebayCategory: "11800",
    ebayQueries: ["refurbished", "certified refurbished"],
  },
  { 
    key: "parts_accessories", 
    categoryKey: "parts_accessories", 
    parentTab: "parts_accessories",
    subtabKey: null,
    isVehicle: false,
    minPrice: 0,
    amazonQueries: ["phone case", "laptop charger", "car phone mount"],
    ebayCategory: "6028",
    ebayQueries: ["phone accessories", "laptop accessories"],
  },
];

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

// Map Rainforest product to ProviderItem
function mapAmazonToProviderItem(p: Record<string, unknown>, categoryKey: string, parentTab: string): ProviderItem {
  const imageUrl = normalizeAndValidateImageUrl(p.imageUrl as string, p.productUrl as string);
  return {
    id: `amazon_${p.providerProductId}`,
    provider: "rainforest",
    providerProductId: p.providerProductId as string,
    title: p.title as string,
    priceUsd: p.priceUsd as number,
    mainImageUrl: imageUrl,
    imageUrl: imageUrl,
    imageCount: 1,
    imageMissing: !imageUrl,
    productUrl: p.productUrl as string,
    inStock: p.inStock ?? true,
    rating: p.rating as number | null,
    unifiedCategory: parentTab,
    unifiedSubcategory: categoryKey.split("_")[1] || null,
  };
}

// Map eBay NormalizedItem to ProviderItem
function mapEbayToProviderItem(item: NormalizedItem, parentTab: string, subtabKey: string | null): ProviderItem {
  const imageUrl = normalizeAndValidateImageUrl(item.image_url, item.product_url);
  return {
    id: item.id,
    provider: "ebay",
    providerProductId: item.provider_product_id,
    title: item.title,
    priceUsd: item.price_usd,
    mainImageUrl: imageUrl,
    imageUrl: imageUrl,
    imageCount: item.image_count || 1,
    imageMissing: !imageUrl,
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    unifiedCategory: parentTab,
    unifiedSubcategory: subtabKey,
  };
}

// Process a single section with timeout
async function processSection(
  supabase: ReturnType<typeof createClient>,
  section: typeof HOME_PREWARM_SECTIONS[0],
  catalogSettings: Awaited<ReturnType<typeof getCatalogSettings>>,
  liveSettings: Awaited<ReturnType<typeof getAmazonLiveSettings>>,
  rotationKey: string,
  avoidRepeatDays: number,
  requestId: string
): Promise<{
  amazonFetched: number;
  ebayFetched: number;
  mixedTotal: number;
  error: string | null;
}> {
  let amazonItems: ProviderItem[] = [];
  let ebayItems: ProviderItem[] = [];

  const maxItemsPerSection = catalogSettings.homeItemsPerSection;
  const amazonFirstCount = catalogSettings.mixedAmazonFirstCount;
  const blendRatio = catalogSettings.mixedBlendRatio;
  const cacheTtlSeconds = catalogSettings.homeCacheTtlSeconds;

  try {
    // ─── FETCH AMAZON ITEMS ─────────────────────────────────────────────────────
    if (catalogSettings.amazonEnabled && liveSettings.amazonHomePrewarmEnabled) {
      for (const query of section.amazonQueries) {
        const budgetCheck = await checkBudget(
          supabase,
          "amazon",
          catalogSettings.amazonBudgetWindow,
          catalogSettings.amazonMaxCallsPerHour,
          requestId
        );

        if (!budgetCheck.allowed) {
          console.log(`[WORKER] requestId=${requestId} section=${section.key} Budget exhausted`);
          break;
        }

        try {
          const result = await searchRainforest(query, 1, 50, "amazon.com");

          if (!result.error && result.products.length > 0) {
            await incrementBudget(supabase, "amazon", catalogSettings.amazonBudgetWindow, requestId);

            for (const p of result.products) {
              if (amazonItems.length >= liveSettings.amazonHomePrewarmMaxItemsPerSection) break;
              
              const blocked = isDisallowedItem({ title: p.title || "", productUrl: p.productUrl || "" });
              if (blocked.isDisallowed) continue;

              amazonItems.push(mapAmazonToProviderItem(p, section.categoryKey, section.parentTab));
            }

            console.log(`[WORKER] requestId=${requestId} section=${section.key} q="${query}" amazonFetched=${result.products.length}`);
          }
        } catch (err) {
          console.error(`[WORKER] requestId=${requestId} section=${section.key} Amazon error:`, err);
        }

        if (amazonItems.length >= liveSettings.amazonHomePrewarmMaxItemsPerSection) break;
      }
    }

    // ─── FETCH EBAY ITEMS ───────────────────────────────────────────────────────
    if (catalogSettings.ebayEnabled) {
      for (const query of section.ebayQueries) {
        if (ebayItems.length >= maxItemsPerSection) break;

        try {
          const result = await searchEbay(
            supabase,
            {
              query,
              categoryId: section.ebayCategory,
              page: 1,
              pageSize: 40,
              minPrice: section.minPrice > 0 ? section.minPrice : undefined,
              isVehicle: section.isVehicle,
              marketplaceId: "EBAY_US",
            },
            requestId
          );

          for (const ebayItem of result.items) {
            if (ebayItems.length >= maxItemsPerSection) break;

            if (isDisallowedItem({ title: ebayItem.title, productUrl: ebayItem.product_url }).isDisallowed) {
              continue;
            }

            if (section.isVehicle) {
              const filterResult = isAllowedMotorListing({ title: ebayItem.title, priceUsd: ebayItem.price_usd });
              if (!filterResult.isAllowed) continue;
            }

            ebayItems.push(mapEbayToProviderItem(ebayItem, section.parentTab, section.subtabKey));
          }

          console.log(`[WORKER] requestId=${requestId} section=${section.key} q="${query}" ebayFetched=${result.items.length}`);
        } catch (err) {
          console.error(`[WORKER] requestId=${requestId} section=${section.key} eBay error:`, err);
        }
      }
    }

    // ─── FILTER OUT RECENTLY SEEN ITEMS ─────────────────────────────────────────
    if (avoidRepeatDays > 0) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - avoidRepeatDays);

      const { data: seenItems } = await supabase
        .from("home_seen_items")
        .select("provider, provider_item_id")
        .eq("section_key", section.key)
        .gte("seen_at", cutoffDate.toISOString());

      if (seenItems && seenItems.length > 0) {
        const seenSet = new Set(seenItems.map(i => `${i.provider}:${i.provider_item_id}`));
        
        const unseenAmazon = amazonItems.filter(i => !seenSet.has(`${i.provider}:${i.providerProductId}`));
        const unseenEbay = ebayItems.filter(i => !seenSet.has(`${i.provider}:${i.providerProductId}`));
        
        if (unseenAmazon.length >= amazonFirstCount / 2) {
          amazonItems = unseenAmazon;
        }
        if (unseenEbay.length >= maxItemsPerSection / 2) {
          ebayItems = unseenEbay;
        }
      }
    }

    // ─── MIX ITEMS USING PROVIDER MIXER ─────────────────────────────────────────
    const cursor = getInitialCursor();
    const mixResult = mixProviderItems({
      amazonItems,
      ebayItems,
      limit: maxItemsPerSection,
      cursor,
      amazonFirstCount,
      blendRatio,
      amazonCap: catalogSettings.amazonMaxResultsPerQuery,
      amazonHasMore: false,
      ebayHasMore: false,
      categoryKey: section.categoryKey,
      requestId,
    });

    const mixedItems = mixResult.items;

    console.log(`[WORKER] requestId=${requestId} section=${section.key} mixed=${mixedItems.length}`);

    // ─── CACHE THE RESULTS ──────────────────────────────────────────────────────
    const { expiresAt, staleAt } = calculateCacheExpiry(cacheTtlSeconds);

    // Cache Amazon items separately
    if (amazonItems.length > 0) {
      await supabase.from("catalog_cache").upsert({
        cache_key: buildHomeSectionAmazonCacheKey(section.key, rotationKey),
        cache_type: "home_amazon",
        provider: "rainforest",
        query: section.amazonQueries[0],
        category: section.categoryKey,
        response: { items: amazonItems, count: amazonItems.length },
        expires_at: expiresAt.toISOString(),
        stale_at: staleAt.toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "cache_key" });
    }

    // Cache eBay items separately
    if (ebayItems.length > 0) {
      await supabase.from("catalog_cache").upsert({
        cache_key: buildHomeSectionEbayCacheKey(section.key, rotationKey),
        cache_type: "home_ebay",
        provider: "ebay",
        query: section.ebayQueries[0],
        category: section.categoryKey,
        response: { items: ebayItems, count: ebayItems.length },
        expires_at: expiresAt.toISOString(),
        stale_at: staleAt.toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "cache_key" });
    }

    // Cache mixed result
    if (mixedItems.length > 0) {
      await supabase.from("catalog_cache").upsert({
        cache_key: buildHomeSectionMixedCacheKey(section.key, rotationKey),
        cache_type: "home_mixed",
        provider: "mixed",
        query: `${section.amazonQueries[0]}|${section.ebayQueries[0]}`,
        category: section.categoryKey,
        response: {
          items: mixedItems,
          count: mixedItems.length,
          amazonCount: amazonItems.length,
          ebayCount: ebayItems.length,
          mixingPhase: mixResult.mixingPhase,
        },
        expires_at: expiresAt.toISOString(),
        stale_at: staleAt.toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "cache_key" });

      // Record seen items
      const seenInserts = mixedItems.map(item => ({
        section_key: section.key,
        rotation_key: rotationKey,
        provider: item.provider,
        provider_item_id: item.providerProductId,
        seen_at: new Date().toISOString(),
      }));

      await supabase.from("home_seen_items").upsert(seenInserts, {
        onConflict: "section_key,rotation_key,provider,provider_item_id",
        ignoreDuplicates: true,
      });

      // Upsert to catalog_items for persistence
      const catalogInserts = mixedItems.map(item => ({
        id: item.id,
        provider: item.provider,
        provider_product_id: item.providerProductId,
        title: item.title,
        price_usd: item.priceUsd,
        image_url: item.imageUrl,
        product_url: item.productUrl,
        in_stock: item.inStock,
        rating: item.rating,
        unified_category: item.unifiedCategory,
        unified_subcategory: item.unifiedSubcategory,
        category_key: section.categoryKey,
        updated_at: new Date().toISOString(),
      }));

      await supabase.from("catalog_items").upsert(catalogInserts, {
        onConflict: "id",
        ignoreDuplicates: false,
      });
    }

    return {
      amazonFetched: amazonItems.length,
      ebayFetched: ebayItems.length,
      mixedTotal: mixedItems.length,
      error: null,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[WORKER] requestId=${requestId} section=${section.key} Error:`, error);
    return {
      amazonFetched: amazonItems.length,
      ebayFetched: ebayItems.length,
      mixedTotal: 0,
      error: errMsg,
    };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  const startTime = Date.now();

  console.log(`[WORKER] requestId=${requestId} Background worker started`);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ ok: false, error: "Backend configuration error" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get jobId from request body
    const body = await req.json().catch(() => ({}));
    const jobId = body.jobId;

    if (!jobId) {
      console.error(`[WORKER] requestId=${requestId} Missing jobId`);
      return new Response(JSON.stringify({ ok: false, error: "Missing jobId" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Load job from database
    const { data: job, error: jobError } = await supabase
      .from("prewarm_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError || !job) {
      console.error(`[WORKER] requestId=${requestId} Job not found: ${jobId}`);
      return new Response(JSON.stringify({ ok: false, error: "Job not found" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Mark job as processing
    await supabase
      .from("prewarm_jobs")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", jobId);

    console.log(`[WORKER] requestId=${requestId} Processing job: ${jobId}, rotationKey: ${job.rotation_key}`);

    // Load settings
    const catalogSettings = await getCatalogSettings(supabase);
    const liveSettings = await getAmazonLiveSettings(supabase);
    const avoidRepeatDays = catalogSettings.homeAvoidRepeatDays;

    let totalAmazonFetched = 0;
    let totalEbayFetched = 0;
    let totalMixed = 0;
    let sectionsCompleted = 0;
    let lastError: string | null = null;

    // Process each section sequentially
    for (const section of HOME_PREWARM_SECTIONS) {
      console.log(`[WORKER] requestId=${requestId} Processing section: ${section.key} (${sectionsCompleted + 1}/${HOME_PREWARM_SECTIONS.length})`);

      // Update current section
      await supabase
        .from("prewarm_jobs")
        .update({ current_section: section.key })
        .eq("id", jobId);

      const result = await processSection(
        supabase,
        section,
        catalogSettings,
        liveSettings,
        job.rotation_key,
        avoidRepeatDays,
        requestId
      );

      totalAmazonFetched += result.amazonFetched;
      totalEbayFetched += result.ebayFetched;
      totalMixed += result.mixedTotal;
      sectionsCompleted++;

      if (result.error) {
        lastError = result.error;
      }

      // Update progress after each section
      await supabase
        .from("prewarm_jobs")
        .update({
          sections_completed: sectionsCompleted,
          amazon_fetched: totalAmazonFetched,
          ebay_fetched: totalEbayFetched,
          mixed_total: totalMixed,
        })
        .eq("id", jobId);

      console.log(`[WORKER] requestId=${requestId} Section ${section.key} completed: amazon=${result.amazonFetched}, ebay=${result.ebayFetched}, mixed=${result.mixedTotal}`);
    }

    // Mark job as completed
    const durationMs = Date.now() - startTime;
    await supabase
      .from("prewarm_jobs")
      .update({
        status: lastError ? "completed_with_errors" : "completed",
        completed_at: new Date().toISOString(),
        error_message: lastError,
        current_section: null,
      })
      .eq("id", jobId);

    console.log(`[WORKER] requestId=${requestId} Job completed in ${durationMs}ms: sections=${sectionsCompleted}, amazon=${totalAmazonFetched}, ebay=${totalEbayFetched}, mixed=${totalMixed}`);

    return new Response(JSON.stringify({
      ok: true,
      jobId,
      sectionsCompleted,
      totalAmazonFetched,
      totalEbayFetched,
      totalMixed,
      durationMs,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[WORKER] requestId=${requestId} Error:`, error);

    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
