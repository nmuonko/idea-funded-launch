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

import { createClient } from "@supabase/supabase-js";

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
  // ─── Electronics (primary focus) ──────────────────────────────────────────
  { category: "electronics", provider: "ebay", seed_key: "electronics_iphone", query: "iphone", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_iphone_15", query: "iphone 15", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_iphone_14", query: "iphone 14", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_samsung", query: "samsung galaxy phone", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_pixel", query: "google pixel phone", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_laptop", query: "laptop", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_macbook", query: "macbook", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_dell", query: "dell laptop", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_hp", query: "hp laptop", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_headphones", query: "headphones", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_airpods", query: "airpods", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_sony_headphones", query: "sony headphones", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_monitor", query: "monitor", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_tv", query: "smart tv", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_tablet", query: "tablet", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_ipad", query: "ipad", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_camera", query: "camera", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_dslr", query: "dslr camera", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_gopro", query: "gopro", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_console_ps5", query: "playstation 5", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_console_xbox", query: "xbox series x", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_nintendo", query: "nintendo switch", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_smartwatch", query: "smartwatch", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_apple_watch", query: "apple watch", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_drone", query: "drone", ttl_minutes: 360 },
  { category: "electronics", provider: "ebay", seed_key: "electronics_speaker", query: "bluetooth speaker", ttl_minutes: 360 },

  // ─── Refurbished electronics ──────────────────────────────────────────────
  { category: "refurbished", provider: "ebay", seed_key: "refurb_iphone", query: "refurbished iphone", ttl_minutes: 360 },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_laptop", query: "renewed laptop", ttl_minutes: 360 },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_macbook", query: "refurbished macbook", ttl_minutes: 360 },
  { category: "refurbished", provider: "ebay", seed_key: "refurb_samsung", query: "refurbished samsung phone", ttl_minutes: 360 },

  // ─── Motors / Cars (Buy It Now, min $1500, no parts/salvage) ──────────────
  {
    category: "motors", provider: "ebay", seed_key: "motors_usedcar", query: "used car",
    ebay_category_id: "6001",
    filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken", "for parts"] },
    ttl_minutes: 720,
  },
  {
    category: "motors", provider: "ebay", seed_key: "motors_toyota", query: "toyota camry",
    ebay_category_id: "6001",
    filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken"] },
    ttl_minutes: 720,
  },
  {
    category: "motors", provider: "ebay", seed_key: "motors_toyota_corolla", query: "toyota corolla",
    ebay_category_id: "6001",
    filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken"] },
    ttl_minutes: 720,
  },
  {
    category: "motors", provider: "ebay", seed_key: "motors_honda", query: "honda civic",
    ebay_category_id: "6001",
    filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken"] },
    ttl_minutes: 720,
  },
  {
    category: "motors", provider: "ebay", seed_key: "motors_honda_accord", query: "honda accord",
    ebay_category_id: "6001",
    filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken"] },
    ttl_minutes: 720,
  },
  {
    category: "motors", provider: "ebay", seed_key: "motors_ford", query: "ford f150",
    ebay_category_id: "6001",
    filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken"] },
    ttl_minutes: 720,
  },
  {
    category: "motors", provider: "ebay", seed_key: "motors_ford_mustang", query: "ford mustang",
    ebay_category_id: "6001",
    filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken"] },
    ttl_minutes: 720,
  },
  {
    category: "motors", provider: "ebay", seed_key: "motors_chevy", query: "chevrolet silverado",
    ebay_category_id: "6001",
    filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken"] },
    ttl_minutes: 720,
  },
  {
    category: "motors", provider: "ebay", seed_key: "motors_nissan", query: "nissan altima",
    ebay_category_id: "6001",
    filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken"] },
    ttl_minutes: 720,
  },
  {
    category: "motors", provider: "ebay", seed_key: "motors_bmw", query: "bmw 3 series",
    ebay_category_id: "6001",
    filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken"] },
    ttl_minutes: 720,
  },
  {
    category: "motors", provider: "ebay", seed_key: "motors_mercedes", query: "mercedes benz",
    ebay_category_id: "6001",
    filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken"] },
    ttl_minutes: 720,
  },
  {
    category: "motors", provider: "ebay", seed_key: "motors_jeep", query: "jeep wrangler",
    ebay_category_id: "6001",
    filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken"] },
    ttl_minutes: 720,
  },
  {
    category: "motors", provider: "ebay", seed_key: "motors_tesla", query: "tesla model 3",
    ebay_category_id: "6001",
    filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken"] },
    ttl_minutes: 720,
  },
  {
    category: "motors", provider: "ebay", seed_key: "motors_suv", query: "suv",
    ebay_category_id: "6001",
    filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken"] },
    ttl_minutes: 720,
  },
  {
    category: "motors", provider: "ebay", seed_key: "motors_pickup", query: "pickup truck",
    ebay_category_id: "6001",
    filters: { buyingOptions: ["FIXED_PRICE"], minPriceUsd: 1500, excludeKeywords: ["auction", "bid", "parts", "salvage", "repair", "broken"] },
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
