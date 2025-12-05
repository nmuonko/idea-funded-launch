import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

/**
 * MaishaPay Get Config
 * 
 * Returns MaishaPay PUBLIC configuration for the frontend.
 * SECURITY: This endpoint NEVER returns secret keys - those are only used server-side
 * in the maishapay-checkout-page edge function which renders the form server-side.
 */

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
    // Get MaishaPay configuration from environment variables
    const gatewayMode = Deno.env.get('MAISHAPAY_GATEWAY_MODE');
    const legacyMode = Deno.env.get('MAISHAPAY_MODE');
    
    // Determine if we're in live mode
    const isLiveMode = gatewayMode === '1' || 
                       legacyMode === '1' || 
                       legacyMode?.toLowerCase() === 'live';
    
    console.log('[maishapay-get-config] Mode detection:', {
      gatewayMode,
      legacyMode,
      isLiveMode,
    });
    
    // Only get public key - NEVER expose secret key via API
    let publicKey: string;
    
    if (isLiveMode) {
      publicKey = Deno.env.get('MAISHAPAY_LIVE_PUBLIC_KEY') || 
                  Deno.env.get('MAISHAPAY_PUBLIC_KEY') || 
                  Deno.env.get('MAISHA_PUBLIC_KEY') || '';
    } else {
      publicKey = Deno.env.get('MAISHAPAY_SANDBOX_PUBLIC_KEY') || 
                  Deno.env.get('MAISHAPAY_PUBLIC_KEY') || 
                  Deno.env.get('MAISHA_PUBLIC_KEY') || '';
    }
    
    // Get callback URL
    const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';
    const callbackUrl = Deno.env.get('MAISHAPAY_CALLBACK_URL') || `${frontendBaseUrl}/maishapay/result`;
    
    // Get the server-side checkout page URL
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const checkoutPageUrl = `${supabaseUrl}/functions/v1/maishapay-checkout-page`;
    
    // Validate configuration
    if (!publicKey) {
      console.error('[maishapay-get-config] Missing public key');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Payment gateway not configured: missing public key' 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('[maishapay-get-config] Returning config (no secret key):', {
      mode: isLiveMode ? 'live' : 'sandbox',
      gatewayMode: isLiveMode ? '1' : '0',
      hasPublicKey: !!publicKey,
      callbackUrl,
    });

    // SECURITY: Return only public information, no secret keys
    return new Response(
      JSON.stringify({
        success: true,
        gatewayMode: isLiveMode ? '1' : '0',
        publicApiKey: publicKey,
        // REMOVED: secretApiKey - never expose via API
        callbackUrl,
        mode: isLiveMode ? 'live' : 'sandbox',
        // Provide the server-side checkout page URL for secure form submission
        checkoutPageUrl,
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: any) {
    console.error('[maishapay-get-config] Error:', error.message);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
