/**
 * Admin Backfill Unified Categories
 * 
 * Backfill function to compute unified_category, listing_type, and subkeys for existing catalog_items.
 * Updated for VEHICLES (top-level) + PARTS_ACCESSORIES structure.
 * 
 * POST /admin-backfill-unified-categories
 * Headers:
 *   - authorization: Bearer <admin_token> OR x-admin-api-key: <ADMIN_API_KEY>
 * 
 * Body (optional):
 *   { "batchSize": 1000, "deleteBlocked": false }
 * 
 * Response:
 *   { success, processed, updated, blocked, skipped, deletedBlocked, durationMs }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { mapCategoryAndSubcategory, resolveCategory, TABS } from "../_shared/categoryMapper.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, apikey, content-type, x-client-info, x-device-id, x-admin-api-key, x-cron-secret",
  "Access-Control-Max-Age": "86400",
};

interface CatalogItemRow {
  id: string;
  title: string | null;
  provider: string | null;
  product_url: string | null;
  unified_category: string | null;
  listing_type: string | null;
  vehicles_subkey: string | null;
  parts_subkey: string | null;
  category_key: string | null;
  metadata?: {
    categoryPath?: string;
    categoryId?: string;
    condition?: string;
    buyingOptions?: string[];
    price?: { value?: string };
  };
}

// Vehicle keywords to identify actual vehicles
const VEHICLE_TITLE_KEYWORDS = [
  "car ", " car", "truck ", " truck", "sedan", "coupe", "suv ", " suv",
  "vehicle", "automobile", "minivan", "pickup", "convertible",
  "motorcycle", "motorbike", "harley", "honda cb", "kawasaki",
  "atv", "utv", "quad", "four wheeler", "side by side",
  "boat", "yacht", "pontoon", "fishing boat", "jet ski", "watercraft",
  "rv ", " rv", "camper", "motorhome", "travel trailer",
  "classic car", "muscle car", "vintage car", "antique car"
];

// Parts keywords to identify parts/accessories
const PARTS_TITLE_KEYWORDS = [
  "parts", "part", "accessory", "accessories", "replacement",
  "wheel", "tire", "rim", "brake", "engine", "motor", "transmission",
  "bumper", "fender", "hood", "door", "mirror", "light", "headlight",
  "taillight", "seat", "exhaust", "muffler", "suspension", "strut",
  "shock", "spring", "oil filter", "air filter", "spark plug",
  "battery", "alternator", "starter", "radiator", "hose", "belt",
  "cover", "mat", "liner", "guard", "protector", "holder", "mount",
  "tool", "wrench", "socket", "jack", "charger", "tester"
];

function detectListingType(title: string, priceUsd: number | null): "vehicle" | "part" | null {
  const titleLower = title.toLowerCase();
  
  // Check for vehicle keywords with high price
  const isVehicleByTitle = VEHICLE_TITLE_KEYWORDS.some(kw => titleLower.includes(kw));
  const isPartByTitle = PARTS_TITLE_KEYWORDS.some(kw => titleLower.includes(kw));
  
  // If it's a part keyword, it's definitely a part
  if (isPartByTitle && !isVehicleByTitle) {
    return "part";
  }
  
  // If it's a vehicle keyword with high price, it's a vehicle
  if (isVehicleByTitle && (priceUsd === null || priceUsd >= 1500)) {
    return "vehicle";
  }
  
  // If it's a vehicle keyword but low price, it's probably a part/accessory
  if (isVehicleByTitle && priceUsd !== null && priceUsd < 1500) {
    return "part";
  }
  
  return null;
}

function detectVehiclesSubkey(title: string): string {
  const titleLower = title.toLowerCase();
  
  if (titleLower.includes("motorcycle") || titleLower.includes("motorbike") || 
      titleLower.includes("harley") || titleLower.includes("honda cb") ||
      titleLower.includes("kawasaki ninja") || titleLower.includes("yamaha r")) {
    return "motorcycles";
  }
  
  if (titleLower.includes("atv") || titleLower.includes("utv") || 
      titleLower.includes("quad") || titleLower.includes("four wheeler") ||
      titleLower.includes("side by side") || titleLower.includes("snowmobile")) {
    return "powersports";
  }
  
  if (titleLower.includes("boat") || titleLower.includes("yacht") || 
      titleLower.includes("pontoon") || titleLower.includes("jet ski") ||
      titleLower.includes("watercraft") || titleLower.includes("kayak")) {
    return "boats";
  }
  
  if (titleLower.includes("rv ") || titleLower.includes(" rv") || 
      titleLower.includes("camper") || titleLower.includes("motorhome") ||
      titleLower.includes("travel trailer") || titleLower.includes("fifth wheel")) {
    return "rvs_campers";
  }
  
  if (titleLower.includes("trailer") && !titleLower.includes("travel trailer")) {
    return "trailers_other";
  }
  
  if (titleLower.includes("classic") || titleLower.includes("vintage") ||
      titleLower.includes("antique") || titleLower.includes("muscle car")) {
    return "classic_cars";
  }
  
  // Default to cars_trucks
  return "cars_trucks";
}

function detectPartsSubkey(title: string): string {
  const titleLower = title.toLowerCase();
  
  if (titleLower.includes("wheel") || titleLower.includes("tire") || titleLower.includes("rim")) {
    return "wheels_tires";
  }
  
  if (titleLower.includes("motorcycle") || titleLower.includes("scooter") || 
      titleLower.includes("moto ") || titleLower.includes("bike part")) {
    return "moto_scooter_parts";
  }
  
  if (titleLower.includes("atv") || titleLower.includes("utv") || titleLower.includes("quad")) {
    return "atv_utv_parts";
  }
  
  if (titleLower.includes("tool") || titleLower.includes("wrench") || 
      titleLower.includes("socket") || titleLower.includes("jack") ||
      titleLower.includes("diagnostic") || titleLower.includes("scanner")) {
    return "tools_supplies";
  }
  
  // Default to car_truck_parts
  return "car_truck_parts";
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminApiKey = Deno.env.get("ADMIN_API_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");

  // Authenticate: admin token OR API key OR cron secret
  let isAuthorized = false;

  // Check API key header
  const apiKeyHeader = req.headers.get("x-admin-api-key");
  if (adminApiKey && apiKeyHeader === adminApiKey) {
    isAuthorized = true;
  }

  // Check cron secret
  const cronSecretHeader = req.headers.get("x-cron-secret");
  if (cronSecret && cronSecretHeader === cronSecret) {
    isAuthorized = true;
  }

  // Check bearer token for admin role
  if (!isAuthorized) {
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.replace("Bearer ", "");
      
      // Allow service role key directly
      if (token === supabaseServiceKey) {
        isAuthorized = true;
      } else {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const { data: claimsData, error: claimsError } = await supabase.auth.getUser(token);
        
        if (!claimsError && claimsData?.user) {
          const { data: roles } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", claimsData.user.id)
            .eq("role", "admin")
            .maybeSingle();
          
          isAuthorized = !!roles;
        }
      }
    }
  }

  if (!isAuthorized) {
    return new Response(
      JSON.stringify({ success: false, error: "Unauthorized: Admin access required" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Parse request body
  let batchSize = 1000;
  let deleteBlocked = false;
  
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body.batchSize === "number" && body.batchSize > 0 && body.batchSize <= 5000) {
      batchSize = body.batchSize;
    }
    if (typeof body.deleteBlocked === "boolean") {
      deleteBlocked = body.deleteBlocked;
    }
  } catch {
    // Use defaults
  }

  console.log(`[BACKFILL_CATEGORIES] Starting with batchSize=${batchSize} deleteBlocked=${deleteBlocked}`);
  console.log(`[BACKFILL_CATEGORIES] Available top-level tabs: ${TABS.map(t => t.key).join(", ")}`);

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Track stats
  let processed = 0;
  let updated = 0;
  let blocked = 0;
  let skipped = 0;
  let deletedBlocked = 0;
  let vehiclesFound = 0;
  let partsFound = 0;
  let hasMore = true;
  let lastId: string | null = null;

  while (hasMore) {
    // Fetch batch of items needing backfill (NULL unified_category OR NULL listing_type for motors-related items)
    let query = supabase
      .from("catalog_items")
      .select("id, title, provider, product_url, unified_category, listing_type, vehicles_subkey, parts_subkey, category_key, metadata, price_usd")
      .or("unified_category.is.null,listing_type.is.null")
      .order("id", { ascending: true })
      .limit(batchSize);

    if (lastId) {
      query = query.gt("id", lastId);
    }

    const { data: items, error: fetchError } = await query;

    if (fetchError) {
      console.error(`[BACKFILL_CATEGORIES] Fetch error: ${fetchError.message}`);
      return new Response(
        JSON.stringify({ success: false, error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!items || items.length === 0) {
      hasMore = false;
      break;
    }

    console.log(`[BACKFILL_CATEGORIES] Processing batch of ${items.length} items, lastId=${lastId || 'start'}`);

    // Process each item
    const updates: { 
      id: string; 
      unified_category: string;
      listing_type: string | null;
      vehicles_subkey: string | null;
      parts_subkey: string | null;
    }[] = [];
    const toDelete: string[] = [];

    for (const row of items as (CatalogItemRow & { price_usd?: number })[]) {
      processed++;
      lastId = row.id;

      // Compute unified_category using mapper
      const { category: mappedCategory, subcategory } = mapCategoryAndSubcategory({
        title: row.title || undefined,
        provider: row.provider || undefined,
        productUrl: row.product_url || undefined,
        ebayCategoryPath: row.metadata?.categoryPath,
        ebayCategoryId: row.metadata?.categoryId,
        condition: row.metadata?.condition,
      });

      // Resolve to canonical category (handles aliases)
      const unifiedCategory = resolveCategory(mappedCategory);

      if (unifiedCategory === "blocked") {
        blocked++;
        if (deleteBlocked) {
          toDelete.push(row.id);
        } else {
          updates.push({ 
            id: row.id, 
            unified_category: "blocked",
            listing_type: null,
            vehicles_subkey: null,
            parts_subkey: null
          });
        }
        continue;
      }

      // Determine listing_type and subkeys
      let listingType: string | null = null;
      let vehiclesSubkey: string | null = null;
      let partsSubkey: string | null = null;
      
      if (unifiedCategory === "vehicles") {
        // Detect if it's actually a vehicle or a part based on title and price
        const detectedType = row.title ? detectListingType(row.title, row.price_usd || null) : null;
        
        if (detectedType === "part") {
          // It's actually a part, reclassify
          updates.push({
            id: row.id,
            unified_category: "parts_accessories",
            listing_type: "part",
            vehicles_subkey: null,
            parts_subkey: row.title ? detectPartsSubkey(row.title) : "all_parts"
          });
          partsFound++;
          continue;
        }
        
        listingType = "vehicle";
        vehiclesSubkey = row.vehicles_subkey || (row.title ? detectVehiclesSubkey(row.title) : "cars_trucks");
        vehiclesFound++;
      } else if (unifiedCategory === "parts_accessories") {
        listingType = "part";
        partsSubkey = row.parts_subkey || (row.title ? detectPartsSubkey(row.title) : "all_parts");
        partsFound++;
      }

      // Check if update is needed
      const needsUpdate = 
        row.unified_category !== unifiedCategory ||
        row.listing_type !== listingType ||
        row.vehicles_subkey !== vehiclesSubkey ||
        row.parts_subkey !== partsSubkey;

      if (needsUpdate) {
        updates.push({
          id: row.id,
          unified_category: unifiedCategory,
          listing_type: listingType,
          vehicles_subkey: vehiclesSubkey,
          parts_subkey: partsSubkey
        });
      } else {
        skipped++;
      }
    }

    // Batch update
    if (updates.length > 0) {
      // Upsert in chunks of 100
      for (let i = 0; i < updates.length; i += 100) {
        const chunk = updates.slice(i, i + 100);
        const { error: updateError } = await supabase
          .from("catalog_items")
          .upsert(
            chunk.map(u => ({ 
              id: u.id, 
              unified_category: u.unified_category,
              listing_type: u.listing_type,
              vehicles_subkey: u.vehicles_subkey,
              parts_subkey: u.parts_subkey,
              updated_at: new Date().toISOString() 
            })),
            { onConflict: "id" }
          );

        if (updateError) {
          console.error(`[BACKFILL_CATEGORIES] Update error: ${updateError.message}`);
        } else {
          updated += chunk.length;
        }
      }
    }

    // Batch delete blocked items
    if (toDelete.length > 0) {
      const { error: deleteError, count } = await supabase
        .from("catalog_items")
        .delete()
        .in("id", toDelete);

      if (deleteError) {
        console.error(`[BACKFILL_CATEGORIES] Delete error: ${deleteError.message}`);
      } else {
        deletedBlocked += count || toDelete.length;
      }
    }

    // If we got fewer items than batch size, we're done
    if (items.length < batchSize) {
      hasMore = false;
    }
  }

  const durationMs = Date.now() - startTime;
  
  console.log(`[BACKFILL_CATEGORIES] Complete: processed=${processed} updated=${updated} blocked=${blocked} skipped=${skipped} deletedBlocked=${deletedBlocked} vehicles=${vehiclesFound} parts=${partsFound} durationMs=${durationMs}`);

  return new Response(
    JSON.stringify({
      success: true,
      processed,
      updated,
      blocked,
      skipped,
      deletedBlocked,
      vehiclesFound,
      partsFound,
      durationMs,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
