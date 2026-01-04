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

    // Fetch bank transfer settings from admin_settings
    const { data, error } = await supabase
      .from('admin_settings')
      .select('value, updated_at')
      .eq('key', 'bank_transfer_details')
      .single();

    if (error && error.code !== 'PGRST116') {
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

    // If no settings found, return empty but valid response
    if (!data) {
      console.log(`[${requestId}] No bank transfer settings configured`);
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

    // Parse the value (stored as JSON string)
    let settings;
    try {
      settings = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
    } catch (parseErr) {
      console.error(`[${requestId}] Failed to parse settings JSON:`, parseErr);
      return new Response(
        JSON.stringify({ success: false, code: 'PARSE_ERROR', message: 'Invalid settings format' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate a version number from updated_at for simple cache busting
    const version = data.updated_at ? new Date(data.updated_at).getTime() : 0;

    console.log(`[${requestId}] Returning bank transfer settings, updated_at:`, data.updated_at, 'version:', version);

    return new Response(
      JSON.stringify({
        success: true,
        configured: true,
        settings: {
          beneficiary_name: settings.beneficiary_name || '',
          bank_name: settings.bank_name || '',
          account_number_or_iban: settings.account_number_or_iban || '',
          swift_bic: settings.swift_bic || '',
          instructions_fr: settings.instructions_fr || '',
          instructions_en: settings.instructions_en || '',
          support_whatsapp: settings.support_whatsapp || '',
          support_email: settings.support_email || '',
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
