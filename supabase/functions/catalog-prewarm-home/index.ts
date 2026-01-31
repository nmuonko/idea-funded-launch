/**
 * catalog-prewarm-home
 * 
 * 12-Hour Rotating Mixed Home Feed Prewarming
 * 
 * Builds mixed Amazon+eBay sections for the home screen using:
 * - Timebucket rotation keys (changes every 12 hours)
 * - Amazon-first ordering with blend ratio
 * - Repeat avoidance using home_seen_items table
 * - Full mixing via providerMixer
 * 
 * Authentication:
 * - Admin token (Authorization header) OR
 * - Cron secret (x-cron-secret header)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyCronAuth, cronAuthErrorResponse } from "../_shared/cronAuth.ts";
import { searchRainforest } from "../_shared/rainforestAdapter.ts";
import { searchEbay, NormalizedItem } from "../_shared/ebayBrowseSearch.ts";
import { getAmazonLiveSettings } from "../_shared/amazonLivePolicy.ts";
import { checkBudget, incrementBudget } from "../_shared/providerBudget.ts";
import { getCatalogSettings } from "../_shared/catalogSettings.ts";
import { mapCategoryAndSubcategory } from "../_shared/categoryMapper.ts";
import { isDisallowedItem } from "../_shared/contentBlocker.ts";
import { isAllowedMotorListing } from "../_shared/motorsFilter.ts";
import { normalizeAndValidateImageUrl } from "../_shared/imageValidation.ts";
import {
  getRotationKey,
  buildHomeSectionMixedCacheKey,
  buildHomeSectionAmazonCacheKey,
  buildHomeSectionEbayCacheKey,
  calculateCacheExpiry,
  buildSectionMetadata,
} from "../_shared/homeRotation.ts";
import {
  mixProviderItems,
  ProviderItem,
  getInitialCursor,
} from "../_shared/providerMixer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// Home sections to prewarm (aligned with catalog-home HOME_SECTIONS)
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

interface PrewarmSectionStats {
  section: string;
  amazonFetched: number;
  ebayFetched: number;
  mixedTotal: number;
  amazonLiveUsed: boolean;
  amazonLiveReason: string;
  seenItemsRecorded: number;
  error: string | null;
}

interface PrewarmResult {
  ok: boolean;
  rotationKey: string;
  sectionsProcessed: number;
  totalAmazonFetched: number;
  totalEbayFetched: number;
  totalMixed: number;
  budgetUsed: number;
  budgetRemaining: number | null;
  stats: PrewarmSectionStats[];
  durationMs: number;
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  const startTime = Date.now();

  console.log(`[PREWARM] requestId=${requestId} Starting 12h rotating home prewarm`);

  // ─── AUTHENTICATION ─────────────────────────────────────────────────────────
  const authHeader = req.headers.get("authorization");
  const cronSecretHeader = req.headers.get("x-cron-secret");

  let isAuthorized = false;

  // Try cron auth first
  if (cronSecretHeader) {
    const cronAuth = verifyCronAuth(req);
    if (cronAuth.authorized) {
      isAuthorized = true;
      console.log(`[PREWARM] requestId=${requestId} Authorized via cron secret`);
    }
  }

  // Try admin token auth
  if (!isAuthorized && authHeader) {
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      
      if (supabaseUrl && supabaseKey) {
        const token = authHeader.replace("Bearer ", "");
        const adminSupabase = createClient(supabaseUrl, supabaseKey);
        const { data: { user }, error: userError } = await adminSupabase.auth.getUser(token);
        
        if (!userError && user) {
          const { data: roleData } = await adminSupabase
            .from("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .eq("role", "admin")
            .single();
          
          if (roleData) {
            isAuthorized = true;
            console.log(`[PREWARM] requestId=${requestId} Authorized via admin token: ${user.email}`);
          }
        }
      }
    } catch (err) {
      console.error(`[PREWARM] requestId=${requestId} Admin auth error:`, err);
    }
  }

  if (!isAuthorized) {
    console.warn(`[PREWARM] requestId=${requestId} Unauthorized access attempt`);
    return cronAuthErrorResponse("Unauthorized - admin token or cron secret required");
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Backend configuration error",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Load settings
    const catalogSettings = await getCatalogSettings(supabase);
    const liveSettings = await getAmazonLiveSettings(supabase);

    // Calculate rotation key
    const rotationKey = getRotationKey(catalogSettings.homeRotationIntervalMinutes);
    console.log(`[PREWARM] requestId=${requestId} rotationKey=${rotationKey}`);

    const maxItemsPerSection = catalogSettings.homeItemsPerSection;
    const amazonFirstCount = catalogSettings.mixedAmazonFirstCount;
    const blendRatio = catalogSettings.mixedBlendRatio;
    const cacheTtlSeconds = catalogSettings.homeCacheTtlSeconds;
    const avoidRepeatDays = catalogSettings.homeAvoidRepeatDays;

    const stats: PrewarmSectionStats[] = [];
    let totalAmazonFetched = 0;
    let totalEbayFetched = 0;
    let totalMixed = 0;
    let budgetUsed = 0;

    // Get recently seen items to avoid repetition
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - avoidRepeatDays);

    // Process each section
    for (const section of HOME_PREWARM_SECTIONS) {
      let amazonItems: ProviderItem[] = [];
      let ebayItems: ProviderItem[] = [];
      let amazonLiveUsed = false;
      let amazonLiveReason = "disabled";
      let sectionError: string | null = null;
      let seenItemsRecorded = 0;

      try {
        // ─── FETCH AMAZON ITEMS ─────────────────────────────────────────────────
        if (catalogSettings.amazonEnabled && liveSettings.amazonHomePrewarmEnabled) {
          for (const query of section.amazonQueries) {
            // Check budget
            const budgetCheck = await checkBudget(
              supabase,
              "amazon",
              catalogSettings.amazonBudgetWindow,
              catalogSettings.amazonMaxCallsPerHour,
              requestId
            );

            if (!budgetCheck.allowed) {
              amazonLiveReason = "budget_exceeded";
              console.log(`[PREWARM] requestId=${requestId} section=${section.key} Budget exhausted`);
              break;
            }

            try {
              const result = await searchRainforest(query, 1, 50, "amazon.com");

              if (!result.error && result.products.length > 0) {
                await incrementBudget(supabase, "amazon", catalogSettings.amazonBudgetWindow, requestId);
                budgetUsed++;
                amazonLiveUsed = true;
                amazonLiveReason = "prewarm_live";

                for (const p of result.products) {
                  if (amazonItems.length >= liveSettings.amazonHomePrewarmMaxItemsPerSection) break;
                  
                  // Content filter
                  const blocked = isDisallowedItem({ title: p.title || "", productUrl: p.productUrl || "" });
                  if (blocked.isDisallowed) continue;

                  amazonItems.push(mapAmazonToProviderItem(p, section.categoryKey, section.parentTab));
                }

                console.log(`[PREWARM] requestId=${requestId} section=${section.key} q="${query}" amazonFetched=${result.products.length}`);
              }
            } catch (err) {
              console.error(`[PREWARM] requestId=${requestId} section=${section.key} Amazon error:`, err);
            }

            if (amazonItems.length >= liveSettings.amazonHomePrewarmMaxItemsPerSection) break;
          }
        } else {
          amazonLiveReason = catalogSettings.amazonEnabled ? "prewarm_disabled" : "disabled";
        }

        // ─── FETCH EBAY ITEMS ───────────────────────────────────────────────────
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

                // Content filter
                if (isDisallowedItem({ title: ebayItem.title, productUrl: ebayItem.product_url }).isDisallowed) {
                  continue;
                }

                // Vehicle filter
                if (section.isVehicle) {
                  const filterResult = isAllowedMotorListing({ title: ebayItem.title, priceUsd: ebayItem.price_usd });
                  if (!filterResult.isAllowed) continue;
                }

                ebayItems.push(mapEbayToProviderItem(ebayItem, section.parentTab, section.subtabKey));
              }

              console.log(`[PREWARM] requestId=${requestId} section=${section.key} q="${query}" ebayFetched=${result.items.length}`);
            } catch (err) {
              console.error(`[PREWARM] requestId=${requestId} section=${section.key} eBay error:`, err);
            }
          }
        }

        // ─── FILTER OUT RECENTLY SEEN ITEMS ─────────────────────────────────────
        if (avoidRepeatDays > 0) {
          const { data: seenItems } = await supabase
            .from("home_seen_items")
            .select("provider, provider_item_id")
            .eq("section_key", section.key)
            .gte("seen_at", cutoffDate.toISOString());

          if (seenItems && seenItems.length > 0) {
            const seenSet = new Set(seenItems.map(i => `${i.provider}:${i.provider_item_id}`));
            
            // Prefer unseen items, but allow seen if not enough
            const unseenAmazon = amazonItems.filter(i => !seenSet.has(`${i.provider}:${i.providerProductId}`));
            const unseenEbay = ebayItems.filter(i => !seenSet.has(`${i.provider}:${i.providerProductId}`));
            
            // Use unseen if we have enough, otherwise mix in seen items
            if (unseenAmazon.length >= amazonFirstCount / 2) {
              amazonItems = unseenAmazon;
            }
            if (unseenEbay.length >= maxItemsPerSection / 2) {
              ebayItems = unseenEbay;
            }
            
            console.log(`[PREWARM] requestId=${requestId} section=${section.key} seenFiltered: amazon=${amazonItems.length} ebay=${ebayItems.length}`);
          }
        }

        // ─── MIX ITEMS USING PROVIDER MIXER ─────────────────────────────────────
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
        totalAmazonFetched += amazonItems.length;
        totalEbayFetched += ebayItems.length;
        totalMixed += mixedItems.length;

        console.log(`[PREWARM] requestId=${requestId} section=${section.key} mixed=${mixedItems.length} phase=${mixResult.mixingPhase}`);

        // ─── CACHE THE RESULTS ──────────────────────────────────────────────────
        const now = new Date();
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
            updated_at: now.toISOString(),
          }, { onConflict: "cache_key" });
        }

        // Cache eBay items separately
        if (ebayItems.length > 0) {
          const ebayExpiry = calculateCacheExpiry(catalogSettings.ebayHomeCacheTtlSeconds);
          await supabase.from("catalog_cache").upsert({
            cache_key: buildHomeSectionEbayCacheKey(section.key, rotationKey),
            cache_type: "home_ebay",
            provider: "ebay",
            query: section.ebayQueries[0],
            category: section.categoryKey,
            response: { items: ebayItems, count: ebayItems.length },
            expires_at: ebayExpiry.expiresAt.toISOString(),
            stale_at: ebayExpiry.staleAt.toISOString(),
            updated_at: now.toISOString(),
          }, { onConflict: "cache_key" });
        }

        // Cache final mixed section
        const metadata = buildSectionMetadata({
          sectionKey: section.key,
          rotationKey,
          amazonCount: amazonItems.length,
          ebayCount: ebayItems.length,
          mixedCount: mixedItems.length,
          amazonLiveUsed,
          amazonLiveReason,
          budgetRemaining: null,
        });

        await supabase.from("catalog_cache").upsert({
          cache_key: buildHomeSectionMixedCacheKey(section.key, rotationKey),
          cache_type: "home_mixed",
          provider: "mixed",
          category: section.categoryKey,
          response: { 
            items: mixedItems, 
            metadata,
            mixingPhase: mixResult.mixingPhase,
          },
          expires_at: expiresAt.toISOString(),
          stale_at: staleAt.toISOString(),
          updated_at: now.toISOString(),
        }, { onConflict: "cache_key" });

        // ─── RECORD SEEN ITEMS ──────────────────────────────────────────────────
        if (mixedItems.length > 0) {
          const seenRecords = mixedItems.map(item => ({
            section_key: section.key,
            provider: item.provider,
            provider_item_id: item.providerProductId,
            rotation_key: rotationKey,
            seen_at: now.toISOString(),
          }));

          // Upsert in batches of 100
          for (let i = 0; i < seenRecords.length; i += 100) {
            const batch = seenRecords.slice(i, i + 100);
            const { error: seenError } = await supabase
              .from("home_seen_items")
              .upsert(batch, { onConflict: "section_key,provider,provider_item_id" });
            
            if (!seenError) {
              seenItemsRecorded += batch.length;
            }
          }
        }

        // ─── UPSERT TO CATALOG_ITEMS ────────────────────────────────────────────
        const catalogUpserts = mixedItems.map(item => ({
          id: item.id,
          provider: item.provider,
          provider_product_id: item.providerProductId,
          title: item.title,
          price_usd: item.priceUsd,
          image_url: item.mainImageUrl,
          images: item.mainImageUrl ? [item.mainImageUrl] : [],
          product_url: item.productUrl,
          in_stock: item.inStock ?? true,
          rating: item.rating,
          unified_category: item.unifiedCategory,
          unified_subcategory: item.unifiedSubcategory,
          updated_at: now.toISOString(),
        }));

        if (catalogUpserts.length > 0) {
          await supabase.from("catalog_items").upsert(catalogUpserts, { onConflict: "id" });
        }

        stats.push({
          section: section.key,
          amazonFetched: amazonItems.length,
          ebayFetched: ebayItems.length,
          mixedTotal: mixedItems.length,
          amazonLiveUsed,
          amazonLiveReason,
          seenItemsRecorded,
          error: null,
        });

      } catch (err) {
        sectionError = err instanceof Error ? err.message : String(err);
        console.error(`[PREWARM] requestId=${requestId} section=${section.key} Error:`, err);
        stats.push({
          section: section.key,
          amazonFetched: 0,
          ebayFetched: 0,
          mixedTotal: 0,
          amazonLiveUsed: false,
          amazonLiveReason: "error",
          seenItemsRecorded: 0,
          error: sectionError,
        });
      }
    }

    // Get final budget status
    const finalBudget = await checkBudget(
      supabase,
      "amazon",
      catalogSettings.amazonBudgetWindow,
      catalogSettings.amazonMaxCallsPerHour,
      requestId
    );

    // Cleanup old seen items
    await supabase.rpc("cleanup_home_seen_items", { p_days_to_keep: avoidRepeatDays });

    const result: PrewarmResult = {
      ok: true,
      rotationKey,
      sectionsProcessed: HOME_PREWARM_SECTIONS.length,
      totalAmazonFetched,
      totalEbayFetched,
      totalMixed,
      budgetUsed,
      budgetRemaining: finalBudget.remaining,
      stats,
      durationMs: Date.now() - startTime,
    };

    console.log(`[PREWARM] requestId=${requestId} Complete: rotation=${rotationKey} amazon=${totalAmazonFetched} ebay=${totalEbayFetched} mixed=${totalMixed} budget=${budgetUsed} duration=${result.durationMs}ms`);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[PREWARM] requestId=${requestId} Error:`, err);

    return new Response(JSON.stringify({
      ok: false,
      error: errorMsg,
      durationMs: Date.now() - startTime,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
