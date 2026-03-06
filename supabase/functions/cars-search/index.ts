/**
 * Cars Search Edge Function
 * 
 * GET /cars-search?make=Toyota&model=Camry&year_min=2020&page=1
 * 
 * Features:
 * - Enforces API enabled check
 * - Per-user/IP rate limiting (429 on excess)
 * - Monthly budget cap (returns mode=degraded if exceeded)
 * - Query normalization and caching
 * - Minimal response payload
 */

import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-forwarded-for",
};

interface CarsSettings {
  cars_api_enabled: boolean;
  cars_api_monthly_budget_usd: number;
  cars_api_budget_action: "show_cached_only" | "degrade_to_request_form";
  cars_search_limits: {
    anon_per_day: number;
    user_per_day: number;
    ip_per_hour: number;
  };
  cars_cache_ttl_minutes: number;
  cars_api_cost_per_call: number;
}

interface CarListing {
  id: string;
  provider: string;
  providerListingId: string;
  title: string;
  price: number | null;
  mileage: number | null;
  year: number | null;
  make: string | null;
  model: string | null;
  location: string | null;
  imageUrl: string | null;
  images: string[]; // Full gallery of images
  listingUrl: string | null;
  vin: string | null;
}

// ─── Settings Helpers ────────────────────────────────────────────────────────

async function getSettings(supabase: any): Promise<CarsSettings> {
  const { data } = await supabase
    .from("cars_settings")
    .select("key, value");
  
  const settings: Record<string, any> = {};
  for (const row of data || []) {
    try {
      settings[row.key] = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
    } catch {
      settings[row.key] = row.value;
    }
  }
  
  return {
    cars_api_enabled: settings.cars_api_enabled ?? true,
    cars_api_monthly_budget_usd: Number(settings.cars_api_monthly_budget_usd) || 50,
    cars_api_budget_action: settings.cars_api_budget_action || "show_cached_only",
    cars_search_limits: settings.cars_search_limits || { anon_per_day: 5, user_per_day: 20, ip_per_hour: 30 },
    cars_cache_ttl_minutes: Number(settings.cars_cache_ttl_minutes) || 30,
    cars_api_cost_per_call: Number(settings.cars_api_cost_per_call) || 0.01,
  };
}

// ─── Rate Limiting ───────────────────────────────────────────────────────────

async function checkRateLimit(
  supabase: any,
  identifier: string,
  identifierType: "user" | "ip" | "anon",
  limit: number
): Promise<{ allowed: boolean; count: number; limit: number }> {
  const today = new Date().toISOString().split("T")[0];
  
  // Upsert and get count
  const { data, error } = await supabase
    .from("cars_rate_limits")
    .upsert({
      identifier,
      identifier_type: identifierType,
      window_date: today,
      request_count: 1,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: "identifier,identifier_type,window_date",
      ignoreDuplicates: false,
    })
    .select("request_count")
    .single();
  
  if (error) {
    // If upsert failed, try to increment
    const { data: existing } = await supabase
      .from("cars_rate_limits")
      .select("request_count")
      .eq("identifier", identifier)
      .eq("identifier_type", identifierType)
      .eq("window_date", today)
      .single();
    
    if (existing) {
      await supabase
        .from("cars_rate_limits")
        .update({ 
          request_count: existing.request_count + 1,
          updated_at: new Date().toISOString()
        })
        .eq("identifier", identifier)
        .eq("identifier_type", identifierType)
        .eq("window_date", today);
      
      return {
        allowed: existing.request_count < limit,
        count: existing.request_count + 1,
        limit,
      };
    }
  }
  
  const count = data?.request_count || 1;
  return { allowed: count <= limit, count, limit };
}

// ─── Budget Check ────────────────────────────────────────────────────────────

async function checkBudget(supabase: any, budgetLimit: number): Promise<{ withinBudget: boolean; spent: number }> {
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
  
  const { data } = await supabase
    .from("cars_api_usage")
    .select("estimated_cost_usd")
    .eq("month", currentMonth);
  
  const spent = (data || []).reduce((sum: number, row: any) => sum + Number(row.estimated_cost_usd || 0), 0);
  
  return { withinBudget: spent < budgetLimit, spent };
}

async function recordApiCall(supabase: any, costPerCall: number): Promise<void> {
  const today = new Date().toISOString().split("T")[0];
  const currentMonth = new Date().toISOString().slice(0, 7);
  
  await supabase
    .from("cars_api_usage")
    .upsert({
      day: today,
      month: currentMonth,
      total_calls: 1,
      estimated_cost_usd: costPerCall,
      updated_at: new Date().toISOString(),
    }, { onConflict: "day" });
  
  // Increment if already exists
  await supabase.rpc("increment_cars_api_usage", { 
    p_day: today, 
    p_cost: costPerCall 
  }).catch(() => {
    // Fallback if RPC doesn't exist
  });
}

// ─── Cache Helpers ───────────────────────────────────────────────────────────

function buildCacheKey(params: Record<string, string>): string {
  const sorted = Object.keys(params)
    .filter(k => params[k])
    .sort()
    .map(k => `${k}=${params[k].toLowerCase().trim()}`)
    .join("&");
  return `cars:${sorted}`;
}

async function getCachedResults(supabase: any, cacheKey: string): Promise<CarListing[] | null> {
  const { data } = await supabase
    .from("cars_search_cache")
    .select("response_json_min, expires_at")
    .eq("cache_key", cacheKey)
    .gt("expires_at", new Date().toISOString())
    .single();
  
  if (data) {
    return data.response_json_min as CarListing[];
  }
  return null;
}

async function cacheResults(
  supabase: any,
  cacheKey: string,
  results: CarListing[],
  ttlMinutes: number,
  isEmpty: boolean
): Promise<void> {
  // Empty results get 2-minute TTL
  const actualTtl = isEmpty ? 2 : ttlMinutes;
  const expiresAt = new Date(Date.now() + actualTtl * 60 * 1000);
  
  await supabase
    .from("cars_search_cache")
    .upsert({
      cache_key: cacheKey,
      response_json_min: results,
      result_count: results.length,
      expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "cache_key" });
}

// ─── External API Call (auto.dev or similar) ─────────────────────────────────

async function fetchFromExternalApi(params: Record<string, string>): Promise<CarListing[]> {
  // For now, return mock data since we don't have auto.dev API key configured
  // In production, this would call the actual API
  
  const apiKey = Deno.env.get("AUTO_DEV_API_KEY");
  
  if (!apiKey) {
    console.log("[cars-search] AUTO_DEV_API_KEY not configured, returning empty");
    return [];
  }
  
  try {
    const searchParams = new URLSearchParams();
    if (params.make) searchParams.set("make", params.make);
    if (params.model) searchParams.set("model", params.model);
    if (params.year_min) searchParams.set("year_min", params.year_min);
    if (params.year_max) searchParams.set("year_max", params.year_max);
    if (params.price_min) searchParams.set("price_min", params.price_min);
    if (params.price_max) searchParams.set("price_max", params.price_max);
    searchParams.set("apikey", apiKey);
    
    const response = await fetch(`https://auto.dev/api/listings?${searchParams}`);
    
    if (!response.ok) {
      console.error("[cars-search] API error:", response.status);
      return [];
    }
    
    const data = await response.json();
    const records = data.records || data.listings || [];
    
    // Extract full image gallery from API response
    const extractImages = (item: any): string[] => {
      const images: string[] = [];
      // Primary photo first if available
      if (item.primaryPhotoUrl) images.push(item.primaryPhotoUrl);
      // Add all photo URLs
      if (Array.isArray(item.photoUrls)) {
        for (const url of item.photoUrls) {
          if (url && !images.includes(url)) images.push(url);
        }
      }
      // Alternative photo array names
      if (Array.isArray(item.photos)) {
        for (const photo of item.photos) {
          const url = typeof photo === 'string' ? photo : photo?.url || photo?.href;
          if (url && !images.includes(url)) images.push(url);
        }
      }
      if (Array.isArray(item.images)) {
        for (const img of item.images) {
          const url = typeof img === 'string' ? img : img?.url || img?.href;
          if (url && !images.includes(url)) images.push(url);
        }
      }
      return images;
    };

    return records.map((item: any) => {
      const images = extractImages(item);
      return {
        id: `auto_dev:${item.id || item.vin}`,
        provider: "auto_dev",
        providerListingId: String(item.id || item.vin),
        title: item.title || `${item.year} ${item.make} ${item.model}`,
        price: item.price ? Number(item.price) : null,
        mileage: item.mileage ? Number(item.mileage) : null,
        year: item.year ? Number(item.year) : null,
        make: item.make || null,
        model: item.model || null,
        location: item.city ? `${item.city}, ${item.state}` : null,
        imageUrl: images[0] || null,
        images, // Full gallery
        listingUrl: item.url || item.listingUrl || null,
        vin: item.vin || null,
      };
    });
  } catch (err) {
    console.error("[cars-search] Fetch error:", err);
    return [];
  }
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const url = new URL(req.url);
  
  // Extract search parameters
  const params: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (["make", "model", "year_min", "year_max", "price_min", "price_max", "page"].includes(key)) {
      params[key] = value;
    }
  }
  
  const page = Math.max(1, parseInt(params.page || "1", 10));
  const pageSize = 20;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    
    if (!supabaseUrl || !supabaseKey) {
      return new Response(JSON.stringify({
        status: "error",
        error: "Backend unavailable",
        items: [],
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Get settings
    const settings = await getSettings(supabase);
    
    // Check if API is enabled
    if (!settings.cars_api_enabled) {
      return new Response(JSON.stringify({
        status: "error",
        mode: "disabled",
        message: "Cars search is currently disabled",
        items: [],
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    // Get user info from auth header
    const authHeader = req.headers.get("authorization");
    let userId: string | null = null;
    
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }
    
    // Get IP for rate limiting
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
               req.headers.get("cf-connecting-ip") || 
               "unknown";
    
    // Check rate limits
    const identifierType = userId ? "user" : "anon";
    const identifier = userId || ip;
    const limit = userId 
      ? settings.cars_search_limits.user_per_day 
      : settings.cars_search_limits.anon_per_day;
    
    const rateCheck = await checkRateLimit(supabase, identifier, identifierType, limit);
    
    if (!rateCheck.allowed) {
      return new Response(JSON.stringify({
        status: "error",
        error: "Rate limit exceeded",
        message: `You have reached your daily search limit (${rateCheck.limit} searches)`,
        items: [],
        rateLimitExceeded: true,
      }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    // Check monthly budget
    const budgetCheck = await checkBudget(supabase, settings.cars_api_monthly_budget_usd);
    
    if (!budgetCheck.withinBudget) {
      // Budget exceeded - return degraded mode
      const { data: cachedListings } = await supabase
        .from("cars_listings_cache")
        .select("*")
        .eq("is_trending", true)
        .order("updated_at", { ascending: false })
        .limit(20);
      
      return new Response(JSON.stringify({
        status: "success",
        mode: "degraded",
        message: settings.cars_api_budget_action === "degrade_to_request_form" 
          ? "Search temporarily unavailable. Please use the request form."
          : "Showing cached results only",
        items: (cachedListings || []).map(mapDbListing),
        page,
        pageSize,
        hasMore: false,
        cached: true,
        budgetExceeded: true,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    // Build cache key
    const cacheKey = buildCacheKey(params);
    
    // Check cache first
    const cachedResults = await getCachedResults(supabase, cacheKey);
    
    if (cachedResults !== null) {
      // Cache hit - return without API call
      const startIndex = (page - 1) * pageSize;
      const paginatedItems = cachedResults.slice(startIndex, startIndex + pageSize);
      
      return new Response(JSON.stringify({
        status: "success",
        mode: "normal",
        items: paginatedItems,
        total: cachedResults.length,
        page,
        pageSize,
        hasMore: startIndex + pageSize < cachedResults.length,
        cached: true,
        durationMs: Date.now() - startTime,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    
    // Cache miss - call external API
    const results = await fetchFromExternalApi(params);
    
    // Record API usage
    await recordApiCall(supabase, settings.cars_api_cost_per_call);
    
    // Cache results
    await cacheResults(supabase, cacheKey, results, settings.cars_cache_ttl_minutes, results.length === 0);
    
    // Also update listings cache for trending
    if (results.length > 0) {
      for (const item of results.slice(0, 20)) {
        await supabase
          .from("cars_listings_cache")
          .upsert({
            provider: item.provider,
            provider_listing_id: item.providerListingId,
            title: item.title,
            price: item.price,
            mileage: item.mileage,
            year: item.year,
            make: item.make,
            model: item.model,
            location: item.location,
            image_url: item.imageUrl,
            images: item.images, // Store full gallery
            listing_url: item.listingUrl,
            vin: item.vin,
            is_trending: false,
            updated_at: new Date().toISOString(),
          }, { onConflict: "provider,provider_listing_id" });
      }
    }
    
    // Paginate results
    const startIndex = (page - 1) * pageSize;
    const paginatedItems = results.slice(startIndex, startIndex + pageSize);
    
    return new Response(JSON.stringify({
      status: "success",
      mode: "normal",
      items: paginatedItems,
      total: results.length,
      page,
      pageSize,
      hasMore: startIndex + pageSize < results.length,
      cached: false,
      durationMs: Date.now() - startTime,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    
  } catch (err) {
    console.error("[cars-search] Error:", err);
    
    return new Response(JSON.stringify({
      status: "error",
      error: err instanceof Error ? err.message : "Unknown error",
      items: [],
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function mapDbListing(row: any): CarListing {
  // Parse images from JSON if available, otherwise use single image
  let images: string[] = [];
  if (row.images) {
    try {
      images = Array.isArray(row.images) ? row.images : JSON.parse(row.images);
    } catch {
      images = [];
    }
  }
  if (images.length === 0 && row.image_url) {
    images = [row.image_url];
  }
  
  return {
    id: `${row.provider}:${row.provider_listing_id}`,
    provider: row.provider,
    providerListingId: row.provider_listing_id,
    title: row.title,
    price: row.price ? Number(row.price) : null,
    mileage: row.mileage,
    year: row.year,
    make: row.make,
    model: row.model,
    location: row.location,
    imageUrl: row.image_url,
    images,
    listingUrl: row.listing_url,
    vin: row.vin,
  };
}
