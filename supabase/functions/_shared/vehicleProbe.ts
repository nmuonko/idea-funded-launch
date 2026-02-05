/**
 * Vehicle Probe - Dynamic vehicle detection for ambiguous queries
 * Makes lightweight eBay probe to determine if query returns vehicles
 */

import { searchEbay } from "./ebayBrowseSearch.ts";
import { buildVehicleProbeKey, VehicleProbeResult } from "./vehicleDetection.ts";

const PROBE_LIMIT = 10;
const VEHICLE_PRICE_THRESHOLD = 1000;
const VEHICLE_COUNT_THRESHOLD = 3;
const PROBE_CACHE_TTL_HOURS = 24;
const PROBE_STALE_TTL_HOURS = 12;

/**
 * Probe eBay vehicle category to determine if query returns actual vehicles
 * Results are cached for 24 hours
 */
// deno-lint-ignore no-explicit-any
export async function probeEbayVehicleCategory(
  supabase: any,
  query: string,
  requestId: string
): Promise<VehicleProbeResult> {
  const probeKey = buildVehicleProbeKey(query);
  
  // Check probe cache first (24h TTL)
  try {
    const { data: cachedProbe } = await supabase
      .from("catalog_cache")
      .select("response")
      .eq("cache_key", probeKey)
      .gt("expires_at", new Date().toISOString())
      .single();
    
    if (cachedProbe?.response) {
      const cached = cachedProbe.response as VehicleProbeResult;
      console.log(JSON.stringify({
        event: "[VEHICLE_PROBE] cache_hit",
        query,
        vehicleMode: cached.vehicleMode,
        vehiclesFound: cached.vehiclesFound,
        requestId,
      }));
      return { ...cached, probeSource: "cache" };
    }
  } catch {
    // Cache miss, proceed with live probe
  }
  
  // Make lightweight eBay probe request
  let vehiclesFound = 0;
  let probeSuccess = false;
  
  try {
    const ebayResult = await searchEbay(
      supabase,
      {
        query,
        page: 1,
        pageSize: PROBE_LIMIT,
        minPrice: undefined,
        isVehicle: true,
        categoryId: "6001",
        marketplaceId: "EBAY_US",
        filters: {},
      },
      `${requestId}_probe`
    );
    
    probeSuccess = true;
    vehiclesFound = ebayResult.items.filter(item => 
      (item.price_usd ?? 0) >= VEHICLE_PRICE_THRESHOLD
    ).length;
    
    console.log(JSON.stringify({
      event: "[VEHICLE_PROBE] live_result",
      query,
      totalReturned: ebayResult.items.length,
      vehiclesFound,
      threshold: VEHICLE_COUNT_THRESHOLD,
      requestId,
    }));
    
  } catch (err) {
    console.error(JSON.stringify({
      event: "[VEHICLE_PROBE] error",
      query,
      error: String(err),
      requestId,
    }));
    return {
      vehicleMode: false,
      vehiclesFound: 0,
      probeSource: "live",
      reason: "probe_error",
    };
  }
  
  const vehicleMode = vehiclesFound >= VEHICLE_COUNT_THRESHOLD;
  const result: VehicleProbeResult = {
    vehicleMode,
    vehiclesFound,
    probeSource: "live",
    reason: vehicleMode ? "probe_vehicles_found" : "probe_insufficient_vehicles",
  };
  
  // Cache probe result for 24 hours
  if (probeSuccess && typeof vehiclesFound === "number") {
    const expiresAt = new Date(Date.now() + PROBE_CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const staleAt = new Date(Date.now() + PROBE_STALE_TTL_HOURS * 60 * 60 * 1000).toISOString();
    
    // Wrap in try/catch since REST client doesn't support .catch()
    try {
      await supabase.from("catalog_cache").upsert({
        cache_key: probeKey,
        cache_type: "search",
        response: result,
        expires_at: expiresAt,
        stale_at: staleAt,
        updated_at: new Date().toISOString(),
      }, { onConflict: "cache_key" });
    } catch (err) {
      console.error(JSON.stringify({
        event: "[VEHICLE_PROBE] cache_write_error",
        query,
        error: String(err),
        requestId,
      }));
    }
  }
  
  return result;
}
