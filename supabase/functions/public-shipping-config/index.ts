// Public Shipping Config - OPTIMIZED FOR 10K+ USERS
// Returns public pricing fields for cart calculations with aggressive caching

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { coalesce, CACHE_TTL } from "../_shared/responseCache.ts";
import { withLoadShedding, getEndpointPriority, LoadSheddingError, loadSheddingResponse } from "../_shared/loadShedding.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, if-none-match',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'public, max-age=900, stale-while-revalidate=300',
};

// Cache key for shipping config (singleton)
const CACHE_KEY = "public-shipping-config";

interface ShippingConfig {
  markup_percent: number;
  markup_percent_display: number;
  shipping_base_fee_usd: number;
  shipping_percent: number;
  shipping_percent_display: number;
  shipping_rate_per_kg: number;
  service_fee_percent: number;
  service_fee_percent_display: number;
  min_service_fee_usd: number;
  exchange_rate_usd_to_cdf: number;
  shipping_categories: Array<{
    key: string;
    label: string;
    est_weight_kg: number;
    flat_shipping_usd: number | null;
    shipping_buffer_percent: number;
    requires_manual_quote: boolean;
  }>;
}

interface CachedResponse {
  config: ShippingConfig;
  updated_at: string;
  version: number;
  etag: string;
}

function generateETag(updatedAt: string | null): string {
  if (!updatedAt) return '"v0"';
  const hash = btoa(updatedAt).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  return `"${hash}"`;
}

async function fetchShippingConfig(): Promise<CachedResponse> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { getCachedGlobalSettings } = await import("../_shared/settingsMemoryCache.ts");
  const data = await getCachedGlobalSettings(supabase) as Record<string, any>;
  const error = (!data || Object.keys(data).length === 0) ? { message: 'Empty settings' } : null;

  if (error) {
    console.error('[public-shipping-config] Database error:', error.message);
    throw new Error(`DB_ERROR: ${error.message}`);
  }

  if (!data) {
    throw new Error('NOT_CONFIGURED: Pricing settings not configured');
  }

  // Also fetch shipping categories
  const { data: categories } = await supabase
    .from('shipping_item_types')
    .select('key, label, est_weight_kg, flat_shipping_usd, shipping_buffer_percent, requires_manual_quote')
    .eq('active', true)
    .order('label');

  // Normalize percentages
  const shippingPercent = data.shipping_percent > 1 
    ? data.shipping_percent / 100 
    : data.shipping_percent;

  const markupPercent = data.markup_percent > 1 
    ? data.markup_percent / 100 
    : data.markup_percent;

  const serviceFeePercent = data.service_fee_percent > 1 
    ? data.service_fee_percent / 100 
    : data.service_fee_percent;

  const version = data.updated_at ? new Date(data.updated_at).getTime() : 0;
  const etag = generateETag(data.updated_at);

  return {
    config: {
      markup_percent: markupPercent,
      markup_percent_display: data.markup_percent,
      shipping_base_fee_usd: Number(data.shipping_base_fee_usd) || 0,
      shipping_percent: shippingPercent,
      shipping_percent_display: data.shipping_percent,
      shipping_rate_per_kg: Number(data.shipping_rate_per_kg) || 20,
      service_fee_percent: serviceFeePercent,
      service_fee_percent_display: data.service_fee_percent,
      min_service_fee_usd: Number(data.min_service_fee_usd) || 0,
      exchange_rate_usd_to_cdf: Number(data.exchange_rate_usd_to_cdf) || 2500,
      shipping_categories: (categories || []).map((c: any) => ({
        key: c.key,
        label: c.label,
        est_weight_kg: Number(c.est_weight_kg) || 0,
        flat_shipping_usd: c.flat_shipping_usd != null ? Number(c.flat_shipping_usd) : null,
        shipping_buffer_percent: Number(c.shipping_buffer_percent) || 0,
        requires_manual_quote: c.requires_manual_quote || false,
      })),
    },
    updated_at: data.updated_at,
    version,
    etag,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ success: false, code: 'METHOD_NOT_ALLOWED', message: 'Only GET is allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const requestId = crypto.randomUUID();
  const priority = getEndpointPriority("public-shipping-config");

  try {
    const cached = await withLoadShedding(priority, async () => {
      // Use request coalescing + caching (15 min TTL)
      return coalesce(CACHE_KEY, fetchShippingConfig, CACHE_TTL.SHIPPING_CONFIG);
    });

    // Check ETag for 304 response
    const clientEtag = req.headers.get('If-None-Match');
    if (clientEtag && clientEtag === cached.etag) {
      console.log(`[${requestId}] ETag match - returning 304`);
      return new Response(null, {
        status: 304,
        headers: { ...corsHeaders, 'ETag': cached.etag }
      });
    }

    console.log(`[${requestId}] Returning shipping config, version: ${cached.version}`);

    return new Response(
      JSON.stringify({
        success: true,
        config: cached.config,
        updated_at: cached.updated_at,
        version: cached.version,
        requestId,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'ETag': cached.etag,
        }
      }
    );

  } catch (error: any) {
    if (error instanceof LoadSheddingError) {
      return loadSheddingResponse(error, corsHeaders);
    }

    console.error(`[${requestId}] Error:`, error?.message || error);
    
    const isNotConfigured = error?.message?.includes('NOT_CONFIGURED');
    
    return new Response(
      JSON.stringify({
        success: false,
        code: isNotConfigured ? 'NOT_CONFIGURED' : 'INTERNAL_ERROR',
        message: isNotConfigured ? 'Pricing settings not configured' : 'An unexpected error occurred',
        requestId,
      }),
      { status: isNotConfigured ? 404 : 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
