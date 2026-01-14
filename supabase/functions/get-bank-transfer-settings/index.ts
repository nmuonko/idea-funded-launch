import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

  const requestId = crypto.randomUUID();
  console.log(`[${requestId}] get-bank-transfer-settings: Start`);

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

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Fetch from dedicated bank_transfer_settings singleton table
    const { data, error } = await supabase
      .from('bank_transfer_settings')
      .select('*')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(`[${requestId}] Database error:`, error.message);
      return new Response(
        JSON.stringify({ success: false, code: 'DB_ERROR', message: 'Failed to fetch settings' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate ETag for cache validation
    const etag = generateETag(data?.updated_at || null);
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

    // If no active settings found, return configured: false (NOT 500)
    if (!data) {
      console.log(`[${requestId}] No active bank transfer settings configured`);
      return new Response(
        JSON.stringify({
          success: true,
          configured: false,
          settings: null,
          updated_at: null,
          version: 0,
          requestId,
        }),
        { 
          status: 200, 
          headers: { 
            ...corsHeaders, 
            'Content-Type': 'application/json',
            'ETag': '"v0"',
          } 
        }
      );
    }

    // Check if settings are actually configured (required fields present)
    const isConfigured = !!(
      data.beneficiary_name && 
      data.bank_name && 
      data.account_number_or_iban
    );

    // Generate a version number from updated_at for simple cache busting
    const version = data.updated_at ? new Date(data.updated_at).getTime() : 0;

    console.log(`[${requestId}] Returning bank transfer settings, configured:`, isConfigured, 'version:', version);

    return new Response(
      JSON.stringify({
        success: true,
        configured: isConfigured,
        settings: {
          beneficiary_name: data.beneficiary_name || '',
          bank_name: data.bank_name || '',
          account_number_or_iban: data.account_number_or_iban || '',
          swift_bic: data.swift_bic || '',
          instructions_fr: data.instructions_fr || '',
          instructions_en: data.instructions_en || '',
          support_whatsapp: data.support_whatsapp || '',
          support_email: data.support_email || '',
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
