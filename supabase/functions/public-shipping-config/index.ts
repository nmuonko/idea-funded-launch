import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, if-none-match',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache',
};

// Generate ETag from updated_at timestamp
function generateETag(updatedAt: string | null): string {
  if (!updatedAt) return '"v0"';
  const hash = btoa(updatedAt).replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  return `"${hash}"`;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Only allow GET
  if (req.method !== 'GET') {
    return new Response(
      JSON.stringify({ success: false, code: 'METHOD_NOT_ALLOWED', message: 'Only GET is allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const requestId = crypto.randomUUID();
  console.log(`[${requestId}] public-shipping-config: Start`);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(`[${requestId}] Missing environment variables`);
      return new Response(
        JSON.stringify({ success: false, code: 'CONFIG_ERROR', message: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use service role to read settings (single source of truth)
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Fetch ONLY the public pricing fields needed for cart calculations
    const { data, error } = await supabase
      .from('settings')
      .select('markup_percent, shipping_base_fee_usd, shipping_percent, service_fee_percent, min_service_fee_usd, exchange_rate_usd_to_cdf, updated_at')
      .limit(1)
      .single();

    if (error) {
      console.error(`[${requestId}] Database error:`, error.message);
      return new Response(
        JSON.stringify({ success: false, code: 'DB_ERROR', message: 'Failed to fetch settings' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!data) {
      console.log(`[${requestId}] No settings found`);
      return new Response(
        JSON.stringify({
          success: false,
          code: 'NOT_CONFIGURED',
          message: 'Pricing settings not configured',
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate ETag for cache validation
    const etag = generateETag(data.updated_at);
    const clientEtag = req.headers.get('If-None-Match');

    // If client has same version, return 304 Not Modified
    if (clientEtag && clientEtag === etag) {
      console.log(`[${requestId}] ETag match - returning 304`);
      return new Response(null, {
        status: 304,
        headers: {
          ...corsHeaders,
          'ETag': etag,
        }
      });
    }

    // Compute version from updated_at for simple cache busting
    const version = data.updated_at ? new Date(data.updated_at).getTime() : 0;

    // Normalize shipping_percent: values > 1 are percentages, <= 1 are fractions
    const shippingPercent = data.shipping_percent > 1 
      ? data.shipping_percent / 100 
      : data.shipping_percent;

    // Normalize markup_percent the same way
    const markupPercent = data.markup_percent > 1 
      ? data.markup_percent / 100 
      : data.markup_percent;

    // Normalize service_fee_percent
    const serviceFeePercent = data.service_fee_percent > 1 
      ? data.service_fee_percent / 100 
      : data.service_fee_percent;

    console.log(`[${requestId}] Returning public shipping config, version: ${version}`);

    // Return ONLY the fields needed for cart total calculations
    // Do NOT include bank info, admin-only fields, or sensitive data
    return new Response(
      JSON.stringify({
        success: true,
        config: {
          markup_percent: markupPercent,
          markup_percent_display: data.markup_percent, // Original value for display
          shipping_base_fee_usd: Number(data.shipping_base_fee_usd) || 0,
          shipping_percent: shippingPercent,
          shipping_percent_display: data.shipping_percent, // Original value for display
          service_fee_percent: serviceFeePercent,
          service_fee_percent_display: data.service_fee_percent, // Original value for display
          min_service_fee_usd: Number(data.min_service_fee_usd) || 0,
          exchange_rate_usd_to_cdf: Number(data.exchange_rate_usd_to_cdf) || 2500,
        },
        updated_at: data.updated_at,
        version: version,
        requestId,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'ETag': etag,
        }
      }
    );

  } catch (error: any) {
    console.error(`[${requestId}] Unexpected error:`, error?.message || error);
    return new Response(
      JSON.stringify({
        success: false,
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        requestId,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
