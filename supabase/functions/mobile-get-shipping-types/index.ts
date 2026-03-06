// Mobile Get Shipping Types - OPTIMIZED FOR 10K+ USERS
// Returns active shipping types with aggressive caching

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { coalesce, CACHE_TTL } from "../_shared/responseCache.ts";
import { withLoadShedding, getEndpointPriority, LoadSheddingError, loadSheddingResponse } from "../_shared/loadShedding.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Cache-Control': 'public, max-age=900, stale-while-revalidate=300',
};

// Cache key for shipping types (singleton)
const CACHE_KEY = "shipping-types";

interface ShippingType {
  id: string;
  key: string;
  label: string;
  description: string | null;
  est_weight_kg: number;
  requires_manual_quote: boolean;
}

async function fetchShippingTypes(): Promise<ShippingType[]> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data: types, error } = await supabase
    .from('shipping_item_types')
    .select('id, key, label, description, est_weight_kg, requires_manual_quote')
    .eq('active', true)
    .order('label');

  if (error) {
    console.error('[mobile-get-shipping-types] Query error:', error);
    throw new Error(`Failed to fetch shipping types: ${error.message}`);
  }

  return types || [];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const priority = getEndpointPriority("mobile-get-shipping-types");

  try {
    const types = await withLoadShedding(priority, async () => {
      // Use request coalescing + caching (15 min TTL)
      return coalesce(CACHE_KEY, fetchShippingTypes, CACHE_TTL.SHIPPING_TYPES);
    });

    console.log('[mobile-get-shipping-types] Returning', types.length, 'types (cached/fresh)');

    return new Response(
      JSON.stringify({ types }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    if (error instanceof LoadSheddingError) {
      return loadSheddingResponse(error, corsHeaders);
    }

    console.error('[mobile-get-shipping-types] Error:', error.message);
    return new Response(
      JSON.stringify({ error: 'An error occurred while fetching shipping types' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
