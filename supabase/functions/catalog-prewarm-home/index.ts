/**
 * catalog-prewarm-home
 * 
 * Prewarming function for Amazon products on the home screen.
 * Called by admin UI "Refresh Amazon Home Cache Now" or scheduled cron.
 * 
 * Features:
 * - Fetches Amazon bestsellers via Rainforest API for each home section
 * - Caches results in catalog_cache for instant home page loads
 * - Upserts products into catalog_items for search/category availability
 * - Respects amazon_home_prewarm_max_items_per_section
 * - Tracks budget usage
 * 
 * Authentication:
 * - Admin token (Authorization header) OR
 * - Cron secret (x-cron-secret header)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyCronAuth, cronAuthErrorResponse } from "../_shared/cronAuth.ts";
import { searchRainforest } from "../_shared/rainforestAdapter.ts";
import { getAmazonLiveSettings, buildAmazonCacheKey } from "../_shared/amazonLivePolicy.ts";
import { checkBudget, incrementBudget } from "../_shared/providerBudget.ts";
import { getCatalogSettings } from "../_shared/catalogSettings.ts";
import { mapCategoryAndSubcategory } from "../_shared/categoryMapper.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// Home section queries to prewarm (matches catalog-home HOME_SECTIONS)
const HOME_PREWARM_SECTIONS = [
  { key: "phones", categoryKey: "electronics_phones", parentTab: "electronics", queries: ["iphone 15", "samsung galaxy", "google pixel"] },
  { key: "gaming", categoryKey: "electronics_gaming", parentTab: "electronics", queries: ["ps5 console", "xbox series x", "nintendo switch"] },
  { key: "computers", categoryKey: "electronics_computers", parentTab: "electronics", queries: ["laptop", "macbook", "gaming laptop"] },
  { key: "audio", categoryKey: "electronics_audio", parentTab: "electronics", queries: ["airpods", "wireless headphones", "bluetooth speaker"] },
  { key: "clothing", categoryKey: "clothing_shoes_accessories", parentTab: "clothing_shoes_accessories", queries: ["sneakers", "hoodie", "running shoes"] },
  { key: "home_garden", categoryKey: "home_garden", parentTab: "home_garden", queries: ["robot vacuum", "air fryer", "blender"] },
  { key: "toys", categoryKey: "toys", parentTab: "toys", queries: ["lego set", "kids toy", "board game"] },
];

interface PrewarmStats {
  section: string;
  query: string;
  fetched: number;
  cached: number;
  upserted: number;
  error: string | null;
}

interface PrewarmResult {
  ok: boolean;
  sectionsProcessed: number;
  totalFetched: number;
  totalCached: number;
  totalUpserted: number;
  budgetUsed: number;
  budgetRemaining: number | null;
  stats: PrewarmStats[];
  durationMs: number;
}

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const requestId = generateRequestId();
  const startTime = Date.now();

  console.log(`[PREWARM] requestId=${requestId} Starting home prewarm`);

  // ─── AUTHENTICATION ─────────────────────────────────────────────────────────
  // Check for either admin token OR cron secret
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
          // Check if user is admin
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

    if (!catalogSettings.amazonEnabled) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Amazon is disabled in settings",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const maxItemsPerSection = liveSettings.amazonHomePrewarmMaxItemsPerSection;
    const stats: PrewarmStats[] = [];
    let totalFetched = 0;
    let totalCached = 0;
    let totalUpserted = 0;
    let budgetUsed = 0;

    // Process each section
    for (const section of HOME_PREWARM_SECTIONS) {
      let sectionFetched = 0;

      for (const query of section.queries) {
        // Check budget before each API call
        const budgetCheck = await checkBudget(
          supabase,
          "amazon",
          catalogSettings.amazonBudgetWindow,
          catalogSettings.amazonMaxCallsPerHour,
          requestId
        );

        if (!budgetCheck.allowed) {
          console.log(`[PREWARM] requestId=${requestId} Budget exhausted, stopping`);
          stats.push({
            section: section.key,
            query,
            fetched: 0,
            cached: 0,
            upserted: 0,
            error: "budget_exceeded",
          });
          continue;
        }

        try {
          console.log(`[PREWARM] requestId=${requestId} section=${section.key} query="${query}"`);

          // Fetch from Rainforest
          const result = await searchRainforest(query, 1, 50, "amazon.com");

          if (result.error) {
            stats.push({
              section: section.key,
              query,
              fetched: 0,
              cached: 0,
              upserted: 0,
              error: result.error,
            });
            continue;
          }

          // Increment budget usage
          await incrementBudget(supabase, "amazon", catalogSettings.amazonBudgetWindow, requestId);
          budgetUsed++;

          const products = result.products.slice(0, maxItemsPerSection - sectionFetched);
          sectionFetched += products.length;
          totalFetched += products.length;

          // Cache results
          const cacheKey = buildAmazonCacheKey({
            query,
            categoryKey: section.categoryKey,
            page: 1,
          });

          const cacheTtlSeconds = catalogSettings.homeCacheTtlSeconds || 86400;
          const now = new Date();
          const expiresAt = new Date(now.getTime() + cacheTtlSeconds * 1000);
          const staleAt = new Date(now.getTime() + (cacheTtlSeconds / 2) * 1000);

          await supabase.from("catalog_cache").upsert({
            cache_key: cacheKey,
            cache_type: "home_prewarm",
            provider: "rainforest",
            query,
            category: section.categoryKey,
            page: 1,
            response: { products, total: result.total, hasMore: result.hasMore },
            expires_at: expiresAt.toISOString(),
            stale_at: staleAt.toISOString(),
            updated_at: now.toISOString(),
          }, { onConflict: "cache_key" });

          totalCached++;

          // Upsert into catalog_items
          const itemsToUpsert = products.map(p => {
            const categoryInfo = mapCategoryAndSubcategory(p.title || "", section.categoryKey);
            return {
              id: `amazon_${p.providerProductId}`,
              provider: "rainforest",
              provider_product_id: p.providerProductId,
              title: p.title,
              price_usd: p.priceUsd,
              image_url: p.imageUrl,
              images: p.imageUrl ? [p.imageUrl] : [],
              product_url: p.productUrl,
              in_stock: p.inStock ?? true,
              rating: p.rating,
              unified_category: categoryInfo.category || section.parentTab,
              unified_subcategory: categoryInfo.subcategory || section.categoryKey.split("_")[1] || null,
              updated_at: now.toISOString(),
            };
          });

          if (itemsToUpsert.length > 0) {
            const { error: upsertError } = await supabase
              .from("catalog_items")
              .upsert(itemsToUpsert, { onConflict: "id" });

            if (!upsertError) {
              totalUpserted += itemsToUpsert.length;
            }
          }

          stats.push({
            section: section.key,
            query,
            fetched: products.length,
            cached: 1,
            upserted: products.length,
            error: null,
          });

          console.log(`[PREWARM] requestId=${requestId} section=${section.key} query="${query}" fetched=${products.length}`);

        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          stats.push({
            section: section.key,
            query,
            fetched: 0,
            cached: 0,
            upserted: 0,
            error: errorMsg,
          });
        }

        // Stop if section max reached
        if (sectionFetched >= maxItemsPerSection) {
          break;
        }
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

    const result: PrewarmResult = {
      ok: true,
      sectionsProcessed: HOME_PREWARM_SECTIONS.length,
      totalFetched,
      totalCached,
      totalUpserted,
      budgetUsed,
      budgetRemaining: finalBudget.remaining,
      stats,
      durationMs: Date.now() - startTime,
    };

    console.log(`[PREWARM] requestId=${requestId} Complete: fetched=${totalFetched} cached=${totalCached} upserted=${totalUpserted} budgetUsed=${budgetUsed} duration=${result.durationMs}ms`);

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
