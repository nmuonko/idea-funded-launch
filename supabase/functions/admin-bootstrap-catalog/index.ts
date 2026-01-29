/**
 * Admin Bootstrap Catalog
 * 
 * One-time setup endpoint that ALWAYS populates DB:
 * 1. Seeds default catalog queries (inline, not separate function call)
 * 2. Runs live refresh for ALL categories (catalog-refresh-seeded?mode=live)
 * 3. Backfills unified_category, listing_type, and subkeys for existing items
 * 
 * POST /admin-bootstrap-catalog
 * Body: { runBackfill?: boolean, maxSeeds?: number }
 * 
 * Requires: admin auth
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { mapCategoryAndSubcategory } from "../_shared/categoryMapper.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret, x-admin-key",
};

// Allow x-admin-key header as alternative auth
function checkAdminKey(req: Request): boolean {
  const adminKey = req.headers.get("x-admin-key");
  const expectedKey = Deno.env.get("CRON_SECRET");
  return adminKey === expectedKey && !!adminKey;
}

// Default seed queries for all categories - Updated for DRC market priorities
// PRIORITY ORDER: Phones > Vehicles > Gaming > Clothing > Home
// NOTE: All queries use unified_subcategory for proper home screen filtering

const DEFAULT_SEEDS = [
  // ============ PHONES (electronics, subcategory: phones) ============
  // iPhone - Top priority
  { category: "electronics", provider: "ebay", seed_key: "phones_iphone_15", query: "iphone 15 unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_iphone_14", query: "iphone 14 unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_iphone_13", query: "iphone 13 unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_iphone_pro", query: "iphone pro max unlocked", filters: { unifiedSubcategory: "phones" } },
  // Samsung Galaxy
  { category: "electronics", provider: "ebay", seed_key: "phones_samsung_s24", query: "samsung galaxy s24 unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_samsung_s23", query: "samsung galaxy s23 unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_samsung_galaxy", query: "samsung galaxy unlocked", filters: { unifiedSubcategory: "phones" } },
  // DRC Popular Brands
  { category: "electronics", provider: "ebay", seed_key: "phones_tecno_camon", query: "tecno camon", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_infinix_hot", query: "infinix hot", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_infinix_note", query: "infinix note", filters: { unifiedSubcategory: "phones" } },
  // Other
  { category: "electronics", provider: "ebay", seed_key: "phones_pixel", query: "google pixel unlocked", filters: { unifiedSubcategory: "phones" } },
  { category: "electronics", provider: "ebay", seed_key: "phones_oneplus", query: "oneplus phone unlocked", filters: { unifiedSubcategory: "phones" } },
  
  // ============ GAMING (electronics, subcategory: gaming) ============
  { category: "electronics", provider: "ebay", seed_key: "gaming_ps5", query: "ps5 console playstation 5", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_ps5_slim", query: "ps5 slim console", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_xbox_x", query: "xbox series x console", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_xbox_s", query: "xbox series s console", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_nintendo", query: "nintendo switch console", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_oled", query: "nintendo switch oled", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_vr", query: "meta quest vr headset", filters: { unifiedSubcategory: "gaming" } },
  { category: "electronics", provider: "ebay", seed_key: "gaming_laptop", query: "gaming laptop", filters: { unifiedSubcategory: "gaming" } },
  
  // ============ OTHER ELECTRONICS ============
  // Tablets
  { category: "electronics", provider: "ebay", seed_key: "electronics_ipad_pro", query: "ipad pro", filters: { unifiedSubcategory: "tablets" } },
  { category: "electronics", provider: "ebay", seed_key: "electronics_ipad", query: "ipad tablet apple", filters: { unifiedSubcategory: "tablets" } },
  { category: "electronics", provider: "ebay", seed_key: "electronics_tab", query: "samsung galaxy tab", filters: { unifiedSubcategory: "tablets" } },
  // Computers
  { category: "electronics", provider: "ebay", seed_key: "electronics_macbook_pro", query: "macbook pro laptop", filters: { unifiedSubcategory: "computers" } },
  { category: "electronics", provider: "ebay", seed_key: "electronics_macbook_air", query: "macbook air laptop", filters: { unifiedSubcategory: "computers" } },
  { category: "electronics", provider: "ebay", seed_key: "electronics_laptop", query: "laptop computer new", filters: { unifiedSubcategory: "computers" } },
  // Audio
  { category: "electronics", provider: "ebay", seed_key: "electronics_airpods", query: "airpods pro", filters: { unifiedSubcategory: "audio" } },
  { category: "electronics", provider: "ebay", seed_key: "electronics_headphones", query: "wireless headphones bluetooth", filters: { unifiedSubcategory: "audio" } },
  // Monitors
  { category: "electronics", provider: "ebay", seed_key: "electronics_monitor", query: "gaming monitor 27 inch", filters: { unifiedSubcategory: "monitors" } },
  
  // ============ VEHICLES (Top-level, Buy It Now only, $1500+ minimum) ============
  // Cars & Trucks
  { 
    category: "vehicles", 
    provider: "ebay", 
    seed_key: "vehicles_cars_toyota", 
    query: "toyota camry car",
    filters: { 
      buyingOptions: ["FIXED_PRICE"], 
      minPriceUsd: 1500, 
      listingType: "vehicle",
      vehiclesSubkey: "cars_trucks",
      excludeKeywords: ["parts", "repair", "salvage", "auction", "bid", "floor mat", "tire", "rim", "wheel", "engine", "motor", "transmission", "bumper", "fender", "hood", "door", "mirror", "light", "brake", "suspension"] 
    } 
  },
  { 
    category: "vehicles", 
    provider: "ebay", 
    seed_key: "vehicles_cars_honda", 
    query: "honda civic sedan",
    filters: { 
      buyingOptions: ["FIXED_PRICE"], 
      minPriceUsd: 1500, 
      listingType: "vehicle",
      vehiclesSubkey: "cars_trucks",
      excludeKeywords: ["parts", "repair", "salvage", "auction", "bid", "floor mat", "tire", "rim", "wheel", "engine", "motor", "transmission", "bumper", "fender", "hood", "door", "mirror", "light", "brake", "suspension"] 
    } 
  },
  { 
    category: "vehicles", 
    provider: "ebay", 
    seed_key: "vehicles_cars_ford", 
    query: "ford f150 truck",
    filters: { 
      buyingOptions: ["FIXED_PRICE"], 
      minPriceUsd: 1500, 
      listingType: "vehicle",
      vehiclesSubkey: "cars_trucks",
      excludeKeywords: ["parts", "repair", "salvage", "auction", "bid", "floor mat", "tire", "rim", "wheel", "engine", "motor", "transmission", "bumper", "fender", "hood", "door", "mirror", "light", "brake", "suspension"] 
    } 
  },
  { 
    category: "vehicles", 
    provider: "ebay", 
    seed_key: "vehicles_cars_bmw", 
    query: "bmw 3 series sedan",
    filters: { 
      buyingOptions: ["FIXED_PRICE"], 
      minPriceUsd: 1500, 
      listingType: "vehicle",
      vehiclesSubkey: "cars_trucks",
      excludeKeywords: ["parts", "repair", "salvage", "auction", "bid", "floor mat", "tire", "rim", "wheel", "engine", "motor", "transmission", "bumper", "fender", "hood", "door", "mirror", "light", "brake", "suspension"] 
    } 
  },
  { 
    category: "vehicles", 
    provider: "ebay", 
    seed_key: "vehicles_cars_suv", 
    query: "SUV 4x4 vehicle",
    filters: { 
      buyingOptions: ["FIXED_PRICE"], 
      minPriceUsd: 1500, 
      listingType: "vehicle",
      vehiclesSubkey: "cars_trucks",
      excludeKeywords: ["parts", "repair", "salvage", "auction", "bid", "floor mat", "tire", "rim", "wheel", "engine", "motor", "transmission", "bumper", "fender", "hood", "door", "mirror", "light", "brake", "suspension"] 
    } 
  },
  
  // Motorcycles
  { 
    category: "vehicles", 
    provider: "ebay", 
    seed_key: "vehicles_motorcycles_harley", 
    query: "harley davidson motorcycle",
    filters: { 
      buyingOptions: ["FIXED_PRICE"], 
      minPriceUsd: 1500, 
      listingType: "vehicle",
      vehiclesSubkey: "motorcycles",
      excludeKeywords: ["parts", "repair", "salvage", "auction", "bid", "helmet", "jacket", "gloves", "exhaust", "seat", "tire", "wheel"] 
    } 
  },
  { 
    category: "vehicles", 
    provider: "ebay", 
    seed_key: "vehicles_motorcycles_honda", 
    query: "honda motorcycle cruiser",
    filters: { 
      buyingOptions: ["FIXED_PRICE"], 
      minPriceUsd: 1500, 
      listingType: "vehicle",
      vehiclesSubkey: "motorcycles",
      excludeKeywords: ["parts", "repair", "salvage", "auction", "bid", "helmet", "jacket", "gloves", "exhaust", "seat", "tire", "wheel"] 
    } 
  },
  
  // Powersports
  { 
    category: "vehicles", 
    provider: "ebay", 
    seed_key: "vehicles_powersports_atv", 
    query: "ATV four wheeler",
    filters: { 
      buyingOptions: ["FIXED_PRICE"], 
      minPriceUsd: 1500, 
      listingType: "vehicle",
      vehiclesSubkey: "powersports",
      excludeKeywords: ["parts", "repair", "salvage", "auction", "bid", "tire", "wheel", "helmet"] 
    } 
  },
  { 
    category: "vehicles", 
    provider: "ebay", 
    seed_key: "vehicles_powersports_utv", 
    query: "UTV side by side",
    filters: { 
      buyingOptions: ["FIXED_PRICE"], 
      minPriceUsd: 1500, 
      listingType: "vehicle",
      vehiclesSubkey: "powersports",
      excludeKeywords: ["parts", "repair", "salvage", "auction", "bid", "tire", "wheel", "helmet"] 
    } 
  },
  
  // Boats
  { 
    category: "vehicles", 
    provider: "ebay", 
    seed_key: "vehicles_boats_fishing", 
    query: "fishing boat motor",
    filters: { 
      buyingOptions: ["FIXED_PRICE"], 
      minPriceUsd: 1500, 
      listingType: "vehicle",
      vehiclesSubkey: "boats",
      excludeKeywords: ["parts", "repair", "salvage", "auction", "bid", "propeller", "anchor", "cover", "seat"] 
    } 
  },
  
  // RVs & Campers
  { 
    category: "vehicles", 
    provider: "ebay", 
    seed_key: "vehicles_rvs_camper", 
    query: "RV camper trailer",
    filters: { 
      buyingOptions: ["FIXED_PRICE"], 
      minPriceUsd: 2000, 
      listingType: "vehicle",
      vehiclesSubkey: "rvs_campers",
      excludeKeywords: ["parts", "repair", "salvage", "auction", "bid", "cover", "awning", "hitch"] 
    } 
  },
  
  // Classic Cars
  { 
    category: "vehicles", 
    provider: "ebay", 
    seed_key: "vehicles_classic_muscle", 
    query: "classic muscle car",
    filters: { 
      buyingOptions: ["FIXED_PRICE"], 
      minPriceUsd: 5000, 
      listingType: "vehicle",
      vehiclesSubkey: "classic_cars",
      excludeKeywords: ["parts", "repair", "salvage", "auction", "bid", "model", "toy", "poster", "sign"] 
    } 
  },
  
  // ============ PARTS & ACCESSORIES ============
  { 
    category: "parts_accessories", 
    provider: "ebay", 
    seed_key: "parts_car_truck", 
    query: "car truck parts",
    filters: { listingType: "part", partsSubkey: "car_truck_parts" } 
  },
  { 
    category: "parts_accessories", 
    provider: "ebay", 
    seed_key: "parts_wheels_tires", 
    query: "wheels tires rims",
    filters: { listingType: "part", partsSubkey: "wheels_tires" } 
  },
  { 
    category: "parts_accessories", 
    provider: "ebay", 
    seed_key: "parts_motorcycle", 
    query: "motorcycle parts accessories",
    filters: { listingType: "part", partsSubkey: "moto_scooter_parts" } 
  },
  { 
    category: "parts_accessories", 
    provider: "ebay", 
    seed_key: "parts_atv_utv", 
    query: "ATV UTV parts",
    filters: { listingType: "part", partsSubkey: "atv_utv_parts" } 
  },
  { 
    category: "parts_accessories", 
    provider: "ebay", 
    seed_key: "parts_tools", 
    query: "automotive tools equipment",
    filters: { listingType: "part", partsSubkey: "tools_supplies" } 
  },
  
  // ============ HOME & GARDEN ============
  { category: "home_garden", provider: "ebay", seed_key: "home_vacuum", query: "robot vacuum cleaner" },
  { category: "home_garden", provider: "ebay", seed_key: "home_airfryer", query: "air fryer kitchen" },
  { category: "home_garden", provider: "ebay", seed_key: "home_blender", query: "blender kitchen" },
  { category: "home_garden", provider: "ebay", seed_key: "home_tools", query: "power tool set" },
  
  // ============ CLOTHING, SHOES & ACCESSORIES - DIVERSIFIED ============
  // Multiple brands + generic item types for variety
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_men_hoodie", query: "men hoodie" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_women_dress", query: "women dress" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_kids_shoes", query: "kids shoes" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_sneakers_men", query: "sneakers men" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_sneakers_women", query: "sneakers women" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_boots", query: "boots" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_handbag", query: "handbag" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_backpack", query: "backpack" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_jacket", query: "jacket" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_coat", query: "coat" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_jeans", query: "jeans" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_tshirt", query: "t-shirt" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_polo", query: "polo shirt" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_sweater", query: "sweater" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_cardigan", query: "cardigan" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_sunglasses", query: "sunglasses" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_belt", query: "belt leather" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_sportswear", query: "sportswear" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_tracksuit", query: "tracksuit" },
  // Brand-specific queries for variety
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_nike", query: "nike" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_adidas", query: "adidas" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_puma", query: "puma" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_newbalance", query: "new balance" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_reebok", query: "reebok" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_underarmour", query: "under armour" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_levis", query: "levi's jeans" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_tommy", query: "tommy hilfiger" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_calvinklein", query: "calvin klein" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_zara", query: "zara" },
  { category: "clothing_shoes_accessories", provider: "ebay", seed_key: "clothing_hm", query: "h&m" },
  
  // ============ TOYS ============
  { category: "toys", provider: "ebay", seed_key: "toys_lego", query: "lego set" },
  { category: "toys", provider: "ebay", seed_key: "toys_kids", query: "kids toys educational" },
  { category: "toys", provider: "ebay", seed_key: "toys_rc", query: "rc car remote control" },
  
  // ============ SPORTING GOODS ============
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_dumbbells", query: "dumbbells weight set" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_soccer", query: "soccer shoes cleats" },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_basketball", query: "basketball shoes" },
  
  // ============ BUSINESS & INDUSTRIAL ============
  { category: "business_industrial", provider: "ebay", seed_key: "business_generator", query: "portable generator" },
  { category: "business_industrial", provider: "ebay", seed_key: "business_compressor", query: "air compressor" },
  
  // ============ JEWELRY & WATCHES ============
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_watch", query: "luxury watch men" },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_necklace", query: "gold necklace chain" },
  
  // ============ REFURBISHED ============
  { category: "refurbished", provider: "ebay", seed_key: "refurb_iphone", query: "refurbished iphone" },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_laptop", query: "renewed laptop" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Auth check
  let isAuthorized = false;
  
  // Check x-admin-key header first
  if (checkAdminKey(req)) {
    isAuthorized = true;
  }
  
  const authHeader = req.headers.get("authorization");
  if (!isAuthorized && authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    if (token === supabaseServiceKey) {
      isAuthorized = true;
    } else {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data: { user } } = await supabase.auth.getUser(token);
      if (user) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .maybeSingle();
        isAuthorized = !!roles;
      }
    }
  }

  const cronSecret = req.headers.get("x-cron-secret");
  if (cronSecret && cronSecret === Deno.env.get("CRON_SECRET")) {
    isAuthorized = true;
  }

  if (!isAuthorized) {
    return new Response(
      JSON.stringify({ success: false, error: "Unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Parse params
  let runBackfill = true;
  let maxSeeds = 50;

  try {
    const body = await req.json().catch(() => ({}));
    runBackfill = body.runBackfill !== false;
    maxSeeds = body.maxSeeds || 50;
  } catch {
    // Use defaults
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const startTime = Date.now();

  const results: Record<string, unknown> = {};

  // Step A: Seed default catalog queries (inline)
  console.log("[BOOTSTRAP] Step A: Seeding default catalog queries with VEHICLES + PARTS structure...");
  try {
    let seededCount = 0;
    let skippedCount = 0;
    
    for (const seed of DEFAULT_SEEDS) {
      const { error } = await supabase
        .from("catalog_seed_queries")
        .upsert({
          ...seed,
          enabled: true,
          ttl_minutes: 360,
          updated_at: new Date().toISOString(),
        }, { onConflict: "provider,seed_key" });
      
      if (error) {
        console.error(`[BOOTSTRAP] Failed to seed ${seed.seed_key}:`, error.message);
        skippedCount++;
      } else {
        seededCount++;
      }
    }
    
    results.seedCatalog = { seeded: seededCount, skipped: skippedCount };
    console.log(`[BOOTSTRAP] Seeded ${seededCount} queries, skipped ${skippedCount}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[BOOTSTRAP] Seed failed:", msg);
    results.seedCatalog = { error: msg };
  }

  // Step B: Run live refresh
  console.log("[BOOTSTRAP] Step B: Running live refresh...");
  try {
    const refreshResponse = await fetch(`${supabaseUrl}/functions/v1/catalog-refresh-seeded`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "live",
        maxSeeds,
      }),
    });
    const refreshResult = await refreshResponse.json();
    results.refreshCatalog = refreshResult;
    console.log("[BOOTSTRAP] Refresh result: Fetched=", refreshResult.totalFetched || 0, "Upserted=", refreshResult.totalUpserted || 0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[BOOTSTRAP] Refresh failed:", msg);
    results.refreshCatalog = { error: msg };
  }

  // Step C: Backfill unified_category, listing_type, and subkeys for existing items
  if (runBackfill) {
    console.log("[BOOTSTRAP] Step C: Backfilling unified_category, listing_type, and subkeys...");
    try {
      // Get items without unified_category OR listing_type
      const { data: itemsToBackfill, error: fetchError } = await supabase
        .from("catalog_items")
        .select("id, title, provider, product_url, metadata, unified_category, listing_type")
        .or("unified_category.is.null,listing_type.is.null")
        .limit(2000);

      if (fetchError) {
        throw new Error(fetchError.message);
      }

      let backfillCount = 0;
      let blockedCount = 0;

      if (itemsToBackfill && itemsToBackfill.length > 0) {
        for (const item of itemsToBackfill) {
          const { category, subcategory } = mapCategoryAndSubcategory({
            title: item.title || undefined,
            provider: item.provider || undefined,
            productUrl: item.product_url || undefined,
            ebayCategoryPath: (item.metadata as Record<string, unknown>)?.categoryPath as string || undefined,
          });

          if (category === "blocked") {
            // Delete blocked items
            await supabase.from("catalog_items").delete().eq("id", item.id);
            blockedCount++;
          } else {
            // Determine listing_type and subkeys
            let listingType: string | null = null;
            let vehiclesSubkey: string | null = null;
            let partsSubkey: string | null = null;
            
            if (category === "vehicles") {
              listingType = "vehicle";
              vehiclesSubkey = subcategory || "cars_trucks";
            } else if (category === "parts_accessories") {
              listingType = "part";
              partsSubkey = subcategory || "all_parts";
            }

            // Update unified_category, listing_type, and subkeys
            await supabase
              .from("catalog_items")
              .update({ 
                unified_category: category, 
                unified_subcategory: subcategory,
                listing_type: listingType,
                vehicles_subkey: vehiclesSubkey,
                parts_subkey: partsSubkey,
                updated_at: new Date().toISOString() 
              })
              .eq("id", item.id);
            backfillCount++;
          }
        }
      }

      results.backfill = {
        processed: itemsToBackfill?.length || 0,
        updated: backfillCount,
        blocked: blockedCount,
      };
      console.log(`[BOOTSTRAP] Backfill: Updated=${backfillCount} Blocked=${blockedCount}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[BOOTSTRAP] Backfill failed:", msg);
      results.backfill = { error: msg };
    }
  }

  // Get final counts
  const { count: totalItems } = await supabase
    .from("catalog_items")
    .select("*", { count: "exact", head: true });

  const { data: categoryCounts } = await supabase
    .from("catalog_items")
    .select("unified_category")
    .not("unified_category", "is", null);

  // Aggregate by category
  const byCategory: Record<string, number> = {};
  if (categoryCounts) {
    for (const row of categoryCounts) {
      const cat = row.unified_category as string;
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(`[BOOTSTRAP] Complete. Total items: ${totalItems} Duration: ${durationMs}ms`);
  console.log(`[BOOTSTRAP] Category breakdown:`, byCategory);

  return new Response(
    JSON.stringify({
      status: "success",
      message: "Catalog bootstrap complete with VEHICLES + PARTS structure",
      totalItems: totalItems || 0,
      categories: byCategory,
      inserted: (results.refreshCatalog as Record<string, unknown>)?.totalUpserted || 0,
      updated: (results.backfill as Record<string, unknown>)?.updated || 0,
      durationMs,
      steps: results,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
