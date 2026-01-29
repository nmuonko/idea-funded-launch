/**
 * Admin Seed Default Catalog
 * 
 * Upserts default seed queries for each category into catalog_seed_queries.
 * eBay-first with Rainforest/Amazon as restricted + cached.
 * 
 * POST /admin-seed-default-catalog
 * Requires: service role OR admin auth
 * 
 * Returns: { success, seeded: { category: seedCount }[] }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret",
};

// ─── Seed Configuration ─────────────────────────────────────────────────────

interface SeedQuery {
  category: string;
  provider: "ebay" | "rainforest";
  seed_key: string;
  query: string;
  ebay_category_id?: string;
  filters?: Record<string, any>;
  ttl_minutes: number;
}

const EBAY_SEEDS: SeedQuery[] = [
  // Electronics (primary focus)
  { category: "electronics", provider: "ebay", seed_key: "electronics_iphone", query: "iphone", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_samsung", query: "samsung phone", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_laptop", query: "laptop", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_headphones", query: "headphones", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_monitor", query: "monitor", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_tablet", query: "tablet", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_camera", query: "camera", ttl_minutes: 360 },
  
  // Home & Garden
  { category: "home_garden", provider: "ebay", seed_key: "home_vacuum", query: "vacuum cleaner", ttl_minutes: 360 },
  { category: "home_garden", provider: "ebay", seed_key: "home_blender", query: "blender", ttl_minutes: 360 },
  { category: "home_garden", provider: "ebay", seed_key: "home_airfryer", query: "air fryer", ttl_minutes: 360 },
  { category: "home_garden", provider: "ebay", seed_key: "home_toolset", query: "tool set", ttl_minutes: 360 },
  
  // Clothing
  { category: "clothing", provider: "ebay", seed_key: "clothing_nike", query: "nike hoodie", ttl_minutes: 360 },
  { category: "clothing", provider: "ebay", seed_key: "clothing_shoes", query: "men shoes", ttl_minutes: 360 },
  { category: "clothing", provider: "ebay", seed_key: "clothing_dress", query: "women dress", ttl_minutes: 360 },
  { category: "clothing", provider: "ebay", seed_key: "clothing_jacket", query: "jacket", ttl_minutes: 360 },
  
  // Toys
  { category: "toys", provider: "ebay", seed_key: "toys_lego", query: "lego", ttl_minutes: 360 },
  { category: "toys", provider: "ebay", seed_key: "toys_kids", query: "kids toy", ttl_minutes: 360 },
  { category: "toys", provider: "ebay", seed_key: "toys_rc", query: "rc car", ttl_minutes: 360 },
  
  // Sporting Goods
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_dumbbells", query: "dumbbells", ttl_minutes: 360 },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_soccer", query: "soccer shoes", ttl_minutes: 360 },
  { category: "sporting_goods", provider: "ebay", seed_key: "sports_basketball", query: "basketball", ttl_minutes: 360 },
  
  // Business & Industrial
  { category: "business_industrial", provider: "ebay", seed_key: "business_generator", query: "generator", ttl_minutes: 360 },
  { category: "business_industrial", provider: "ebay", seed_key: "business_compressor", query: "compressor", ttl_minutes: 360 },
  { category: "business_industrial", provider: "ebay", seed_key: "business_powertool", query: "power tool", ttl_minutes: 360 },
  
  // Jewelry & Watches
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_watch", query: "watch", ttl_minutes: 360 },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_necklace", query: "necklace", ttl_minutes: 360 },
  { category: "jewelry_watches", provider: "ebay", seed_key: "jewelry_ring", query: "ring", ttl_minutes: 360 },
  
  // Refurbished
  { category: "refurbished", provider: "ebay", seed_key: "refurb_iphone", query: "refurbished iphone", ttl_minutes: 360 },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_laptop", query: "renewed laptop", ttl_minutes: 360 },
  
  // Motors - with special filters for Buy It Now and min price
  {
    category: "motors",
    provider: "ebay",
    seed_key: "motors_usedcar",
    query: "used car",
    ebay_category_id: "6001", // eBay Motors: Cars & Trucks
    filters: {
      buyingOptions: ["FIXED_PRICE"],
      minPriceUsd: 1500,
      excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken", "for parts"],
    },
    ttl_minutes: 720, // 12 hours for motors
  },
  {
    category: "motors",
    provider: "ebay",
    seed_key: "motors_toyota",
    query: "toyota camry",
    ebay_category_id: "6001",
    filters: {
      buyingOptions: ["FIXED_PRICE"],
      minPriceUsd: 1500,
      excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken"],
    },
    ttl_minutes: 720,
  },
  {
    category: "motors",
    provider: "ebay",
    seed_key: "motors_honda",
    query: "honda civic",
    ebay_category_id: "6001",
    filters: {
      buyingOptions: ["FIXED_PRICE"],
      minPriceUsd: 1500,
      excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken"],
    },
    ttl_minutes: 720,
  },
  {
    category: "motors",
    provider: "ebay",
    seed_key: "motors_ford",
    query: "ford f150",
    ebay_category_id: "6001",
    filters: {
      buyingOptions: ["FIXED_PRICE"],
      minPriceUsd: 1500,
      excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken"],
    },
    ttl_minutes: 720,
  },
];

// Rainforest seeds - RESTRICTED (expensive API, only electronics)
const RAINFOREST_SEEDS: SeedQuery[] = [
  { category: "electronics", provider: "rainforest", seed_key: "rf_electronics_phones", query: "iphone", ttl_minutes: 1440 }, // 24h cache
  { category: "electronics", provider: "rainforest", seed_key: "rf_electronics_laptops", query: "laptop", ttl_minutes: 1440 },
];

const ALL_SEEDS = [...EBAY_SEEDS, ...RAINFOREST_SEEDS];

// ─── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  
  // Auth: service role or admin user
  let isAuthorized = false;
  
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    
    // Check if it's service role key
    if (token === supabaseServiceKey) {
      isAuthorized = true;
    } else {
      // Check for admin user
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

  // Also check cron secret for scheduled runs
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

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  console.log(`[SEED] Starting seed upsert for ${ALL_SEEDS.length} seed queries`);

  const results: Record<string, number> = {};
  let totalSeeded = 0;
  let errors: string[] = [];

  for (const seed of ALL_SEEDS) {
    try {
      const { error } = await supabase
        .from("catalog_seed_queries")
        .upsert({
          category: seed.category,
          provider: seed.provider,
          seed_key: seed.seed_key,
          query: seed.query,
          ebay_category_id: seed.ebay_category_id || null,
          filters: seed.filters || {},
          ttl_minutes: seed.ttl_minutes,
          enabled: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: "provider,seed_key" });

      if (error) {
        console.error(`[SEED] Error upserting ${seed.seed_key}:`, error.message);
        errors.push(`${seed.seed_key}: ${error.message}`);
      } else {
        results[seed.category] = (results[seed.category] || 0) + 1;
        totalSeeded++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(`[SEED] Exception for ${seed.seed_key}:`, msg);
      errors.push(`${seed.seed_key}: ${msg}`);
    }
  }

  console.log(`[SEED] Completed. Seeded ${totalSeeded}/${ALL_SEEDS.length} seeds. By category:`, results);

  return new Response(
    JSON.stringify({
      success: errors.length === 0,
      totalSeeded,
      totalExpected: ALL_SEEDS.length,
      byCategory: results,
      errors: errors.length > 0 ? errors : undefined,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
