import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    console.log('[mobile-get-shipping-types] Fetching active shipping types');

    const { data: types, error } = await supabase
      .from('shipping_item_types')
      .select('id, key, label, description, est_weight_kg, requires_manual_quote')
      .eq('active', true)
      .order('label');

    if (error) {
      console.error('[mobile-get-shipping-types] Query error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch shipping types' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[mobile-get-shipping-types] Returning', types?.length || 0, 'types');

    return new Response(
      JSON.stringify({ types: types || [] }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[mobile-get-shipping-types] Error:', error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
