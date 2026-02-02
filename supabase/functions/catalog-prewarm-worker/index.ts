/**
 * catalog-prewarm-worker
 * 
 * Self-chaining background worker for home feed prewarming
 * 
 * Processes ONE section per invocation to avoid timeout:
 * 1. Receives jobId + sectionIndex from caller
 * 2. Processes only the section at that index
 * 3. Updates prewarm_jobs progress + heartbeat
 * 4. Self-chains to next section (fire-and-forget)
 * 5. Marks job complete when all sections done
 * 
 * UPDATED: Now reads seed queries from home_section_seeds database table
 * with fallback to TEMPLATE_LIBRARY for hybrid/auto modes.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { searchRainforest } from "../_shared/rainforestAdapter.ts";
import { searchEbay, NormalizedItem } from "../_shared/ebayBrowseSearch.ts";
import { getAmazonLiveSettings } from "../_shared/amazonLivePolicy.ts";
import { checkBudget, incrementBudget } from "../_shared/providerBudget.ts";
import { getCatalogSettings } from "../_shared/catalogSettings.ts";
import { isDisallowedItem } from "../_shared/contentBlocker.ts";
import { applyItemDiversity, logBrandDistribution } from "../_shared/brandExtractor.ts";
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
import { getTemplateQueries } from "../_shared/homeSeedTemplates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Section configuration type (loaded from DB)
interface SectionConfig {
  key: string;
  categoryKey: string;
  parentTab: string;
  subtabKey: string | null;
  isVehicle: boolean;
  minPrice: number;
  amazonQueries: string[];
  ebayQueries: string[];
  ebayCategory: string;
}

/**
 * Load section configuration from home_sections table
 * and merge with seed queries from home_section_seeds
 */
async function loadSectionConfig(
  supabase: ReturnType<typeof createClient>,
  seedMode: string,
  maxQueriesPerSection: number
): Promise<SectionConfig[]> {
  // Get all enabled sections from DB
  const { data: sections, error } = await supabase
    .from("home_sections")
    .select("*")
    .eq("enabled", true)
    .order("sort_order", { ascending: true });

  if (error || !sections || sections.length === 0) {
    console.warn("[WORKER] No sections found in home_sections, using fallback");
    return getDefaultSections();
  }

  const configs: SectionConfig[] = [];

  for (const section of sections) {
    // Get seeds from DB
    const { data: seeds } = await supabase
      .from("home_section_seeds")
      .select("query, weight")
      .eq("section_key", section.key)
      .eq("enabled", true)
      .order("weight", { ascending: false })
      .limit(maxQueriesPerSection);

    const dbQueries = (seeds || []).map(s => s.query);
    
    // Determine queries based on seed mode
    let finalQueries: string[] = [];
    
    if (seedMode === "auto") {
      // Use only template library
      finalQueries = getTemplateQueries(section.key).slice(0, maxQueriesPerSection);
    } else if (seedMode === "hybrid") {
      // Use DB seeds first, fill with templates
      finalQueries = [...dbQueries];
      if (finalQueries.length < maxQueriesPerSection) {
        const templates = getTemplateQueries(section.key);
        const fillers = templates
          .filter(t => !finalQueries.includes(t))
          .slice(0, maxQueriesPerSection - finalQueries.length);
        finalQueries = [...finalQueries, ...fillers];
      }
    } else {
      // Manual mode: use only DB seeds
      finalQueries = dbQueries.length > 0 
        ? dbQueries 
        : getTemplateQueries(section.key).slice(0, 3); // Fallback minimum
    }

    // Determine parent tab from category key
    const parentTab = section.default_category_key?.split("_")[0] || section.key;
    const subtabKey = section.default_category_key?.includes("_") 
      ? section.default_category_key.split("_").slice(1).join("_")
      : null;

    configs.push({
      key: section.key,
      categoryKey: section.default_category_key || section.key,
      parentTab,
      subtabKey,
      isVehicle: section.is_vehicle || false,
      minPrice: section.min_price || 0,
      amazonQueries: finalQueries,
      ebayQueries: finalQueries, // Use same queries for eBay
      ebayCategory: section.ebay_category || "",
    });
  }

  return configs;
}

/**
 * Default sections fallback (used when DB is empty)
 */
function getDefaultSections(): SectionConfig[] {
  return [
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
}

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
    images: (p.images && Array.isArray(p.images) && p.images.length > 0) ? p.images as string[] : (imageUrl ? [imageUrl] : []),
    imageUrls: (p.images && Array.isArray(p.images) && p.images.length > 0) ? p.images as string[] : (imageUrl ? [imageUrl] : []),
    imageCount: (p.imageCount as number) || ((p.images as string[])?.length || 1),
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
    images: item.images || item.image_urls || (imageUrl ? [imageUrl] : []),
    imageUrls: item.images || item.image_urls || (imageUrl ? [imageUrl] : []),
    imageCount: item.image_count || (item.images?.length || item.image_urls?.length || 1),
    imageMissing: !imageUrl,
    productUrl: item.product_url,
    inStock: item.in_stock,
    rating: item.rating,
    unifiedCategory: parentTab,
    unifiedSubcategory: subtabKey,
  };
}

// Process a single section
async function processSection(
  supabase: ReturnType<typeof createClient>,
  section: SectionConfig,
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
    // Skip Amazon for vehicle sections - Amazon only sells accessories, not real cars/trucks
    if (catalogSettings.amazonEnabled && liveSettings.amazonHomePrewarmEnabled && !section.isVehicle) {
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

    let mixedItems = mixResult.items;

    // ─── APPLY ITEM DIVERSITY (INTERLEAVE BY BRAND) ─────────────────────────────
    // Skip diversity for vehicles (each car is unique) and when few items
    if (!section.isVehicle && mixedItems.length > 4) {
      // Determine diversity settings based on category
      const maxPerBrand = section.categoryKey.startsWith("electronics") ? 2 : 3;
      
      // Log distribution before diversity
      logBrandDistribution(mixedItems, `[WORKER_DIVERSITY_BEFORE] section=${section.key}`);
      
      mixedItems = applyItemDiversity(mixedItems, {
        maxPerBrand,
        targetCount: maxItemsPerSection,
        categoryHint: section.categoryKey,
        shuffle: true, // Shuffle for variety on each prewarm
      });
      
      // Log distribution after diversity
      logBrandDistribution(mixedItems, `[WORKER_DIVERSITY_AFTER] section=${section.key}`);
      
      console.log(`[WORKER] requestId=${requestId} section=${section.key} diversity applied maxPerBrand=${maxPerBrand}`);
    }

    console.log(`[WORKER] requestId=${requestId} section=${section.key} mixed=${mixedItems.length}`);

    // ─── CACHE THE RESULTS ──────────────────────────────────────────────────────
    const { expiresAt, staleAt } = calculateCacheExpiry(cacheTtlSeconds);

    // Cache Amazon items separately
    if (amazonItems.length > 0) {
      const amazonCacheKey = buildHomeSectionAmazonCacheKey(section.key, rotationKey);
      const { error: amazonCacheError } = await supabase.from("catalog_cache").upsert({
        cache_key: amazonCacheKey,
        cache_type: "home_amazon",
        provider: "rainforest",
        query: section.amazonQueries[0],
        category: section.categoryKey,
        response: { items: amazonItems, count: amazonItems.length },
        expires_at: expiresAt.toISOString(),
        stale_at: staleAt.toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "cache_key" });
      
      if (amazonCacheError) {
        console.error(`[WORKER] requestId=${requestId} section=${section.key} Amazon cache upsert FAILED:`, amazonCacheError.message, amazonCacheError.code);
      } else {
        console.log(`[WORKER] requestId=${requestId} section=${section.key} Amazon cache saved: ${amazonCacheKey}`);
      }
    }

    // Cache eBay items separately
    if (ebayItems.length > 0) {
      const ebayCacheKey = buildHomeSectionEbayCacheKey(section.key, rotationKey);
      const { error: ebayCacheError } = await supabase.from("catalog_cache").upsert({
        cache_key: ebayCacheKey,
        cache_type: "home_ebay",
        provider: "ebay",
        query: section.ebayQueries[0],
        category: section.categoryKey,
        response: { items: ebayItems, count: ebayItems.length },
        expires_at: expiresAt.toISOString(),
        stale_at: staleAt.toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "cache_key" });
      
      if (ebayCacheError) {
        console.error(`[WORKER] requestId=${requestId} section=${section.key} eBay cache upsert FAILED:`, ebayCacheError.message, ebayCacheError.code);
      } else {
        console.log(`[WORKER] requestId=${requestId} section=${section.key} eBay cache saved: ${ebayCacheKey}`);
      }
    }

    // Cache mixed result
    if (mixedItems.length > 0) {
      const mixedCacheKey = buildHomeSectionMixedCacheKey(section.key, rotationKey);
      const { error: mixedCacheError } = await supabase.from("catalog_cache").upsert({
        cache_key: mixedCacheKey,
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
      
      if (mixedCacheError) {
        console.error(`[WORKER] requestId=${requestId} section=${section.key} Mixed cache upsert FAILED:`, mixedCacheError.message, mixedCacheError.code);
      } else {
        console.log(`[WORKER] requestId=${requestId} section=${section.key} Mixed cache saved: ${mixedCacheKey}`);
      }

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

// Trigger self for next section (fire-and-forget)
async function chainToNextSection(
  supabaseUrl: string,
  serviceKey: string,
  jobId: string,
  nextSectionIndex: number,
  requestId: string
): Promise<void> {
  try {
    const workerUrl = `${supabaseUrl}/functions/v1/catalog-prewarm-worker`;
    
    // Fire-and-forget: don't await the response
    fetch(workerUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jobId, sectionIndex: nextSectionIndex }),
    }).catch(err => {
      console.error(`[WORKER] requestId=${requestId} Failed to chain to section ${nextSectionIndex}:`, err);
    });
    
    console.log(`[WORKER] requestId=${requestId} Chained to section ${nextSectionIndex}`);
  } catch (err) {
    console.error(`[WORKER] requestId=${requestId} Chain error:`, err);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  const startTime = Date.now();

  console.log(`[WORKER] requestId=${requestId} Worker invocation started`);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({ ok: false, error: "Backend configuration error" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get jobId and sectionIndex from request body
    const body = await req.json().catch(() => ({}));
    const jobId = body.jobId;
    const sectionIndex = body.sectionIndex ?? 0;

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

    // Check if job was cancelled or already completed
    if (job.status === 'cancelled' || job.status === 'completed' || job.status === 'failed') {
      console.log(`[WORKER] requestId=${requestId} Job ${jobId} already ${job.status}, skipping`);
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: job.status }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load section configuration from database (with fallback to defaults)
    const { data: seedModeRow } = await supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "home_seed_mode")
      .single();
    const seedMode = seedModeRow?.value || "manual";

    const { data: maxQueriesRow } = await supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "home_seed_max_queries_per_section")
      .single();
    const maxQueriesPerSection = parseInt(maxQueriesRow?.value || "12", 10);

    const sections = await loadSectionConfig(supabase, seedMode, maxQueriesPerSection);
    const totalSections = sections.length;

    // Validate section index
    if (sectionIndex < 0 || sectionIndex >= totalSections) {
      console.error(`[WORKER] requestId=${requestId} Invalid sectionIndex: ${sectionIndex}, totalSections: ${totalSections}`);
      return new Response(JSON.stringify({ ok: false, error: "Invalid sectionIndex" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const section = sections[sectionIndex];

    console.log(`[WORKER] requestId=${requestId} Processing job=${jobId} section=${section.key} (${sectionIndex + 1}/${totalSections})`);

    // Mark job as processing and update heartbeat
    if (sectionIndex === 0) {
      await supabase
        .from("prewarm_jobs")
        .update({ 
          status: "processing", 
          started_at: new Date().toISOString(),
          current_section: section.key,
          last_heartbeat: new Date().toISOString(),
        })
        .eq("id", jobId);
    } else {
      // Just update current section and heartbeat
      await supabase
        .from("prewarm_jobs")
        .update({ 
          current_section: section.key,
          last_heartbeat: new Date().toISOString(),
        })
        .eq("id", jobId);
    }

    // Load settings
    const catalogSettings = await getCatalogSettings(supabase);
    const liveSettings = await getAmazonLiveSettings(supabase);
    const avoidRepeatDays = catalogSettings.homeAvoidRepeatDays;

    // Process THIS section only
    const result = await processSection(
      supabase,
      section,
      catalogSettings,
      liveSettings,
      job.rotation_key,
      avoidRepeatDays,
      requestId
    );

    // Calculate running totals
    const newAmazonTotal = (job.amazon_fetched || 0) + result.amazonFetched;
    const newEbayTotal = (job.ebay_fetched || 0) + result.ebayFetched;
    const newMixedTotal = (job.mixed_total || 0) + result.mixedTotal;
    const newSectionsCompleted = sectionIndex + 1;

    // Update progress in database
    await supabase
      .from("prewarm_jobs")
      .update({
        sections_completed: newSectionsCompleted,
        amazon_fetched: newAmazonTotal,
        ebay_fetched: newEbayTotal,
        mixed_total: newMixedTotal,
        last_heartbeat: new Date().toISOString(),
      })
      .eq("id", jobId);

    console.log(`[WORKER] requestId=${requestId} Section ${section.key} completed: amazon=${result.amazonFetched}, ebay=${result.ebayFetched}, mixed=${result.mixedTotal}`);

    const durationMs = Date.now() - startTime;

    // Check if more sections remain
    const nextSectionIndex = sectionIndex + 1;

    if (nextSectionIndex < totalSections) {
      // Chain to next section (fire-and-forget)
      await chainToNextSection(supabaseUrl, supabaseKey, jobId, nextSectionIndex, requestId);

      return new Response(JSON.stringify({
        ok: true,
        jobId,
        sectionProcessed: section.key,
        sectionIndex,
        sectionsCompleted: newSectionsCompleted,
        totalSections,
        chainedToNext: true,
        durationMs,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // All sections complete - mark job as done
    const hasErrors = result.error !== null;
    
    await supabase
      .from("prewarm_jobs")
      .update({
        status: hasErrors ? "completed_with_errors" : "completed",
        completed_at: new Date().toISOString(),
        error_message: result.error,
        current_section: null,
        last_heartbeat: new Date().toISOString(),
      })
      .eq("id", jobId);

    console.log(`[WORKER] requestId=${requestId} Job completed: sections=${newSectionsCompleted}, amazon=${newAmazonTotal}, ebay=${newEbayTotal}, mixed=${newMixedTotal}, durationMs=${durationMs}`);

    return new Response(JSON.stringify({
      ok: true,
      jobId,
      sectionProcessed: section.key,
      sectionIndex,
      sectionsCompleted: newSectionsCompleted,
      totalSections,
      jobComplete: true,
      totalAmazonFetched: newAmazonTotal,
      totalEbayFetched: newEbayTotal,
      totalMixed: newMixedTotal,
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
