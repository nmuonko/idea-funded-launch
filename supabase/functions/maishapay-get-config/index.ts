import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

/**
 * MaishaPay Get Config
 * 
 * Returns MaishaPay configuration for the frontend checkout form.
 * This is called by the /maishapay/checkout page to get the required form fields.
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
    // Check both MAISHAPAY_GATEWAY_MODE and MAISHAPAY_MODE for flexibility
    const gatewayMode = Deno.env.get('MAISHAPAY_GATEWAY_MODE');
    const legacyMode = Deno.env.get('MAISHAPAY_MODE');
    
    // Determine if we're in live mode:
    // MAISHAPAY_GATEWAY_MODE: "1" = live, "0" = sandbox
    // MAISHAPAY_MODE: "1" or "live" = live, anything else = sandbox
    const isLiveMode = gatewayMode === '1' || 
                       legacyMode === '1' || 
                       legacyMode?.toLowerCase() === 'live';
    
    console.log('[maishapay-get-config] Mode detection:', {
      gatewayMode,
      legacyMode,
      isLiveMode,
    });
    
    // Get keys based on mode
    let publicKey: string;
    let secretKey: string;
    
    if (isLiveMode) {
      // Live mode - use LIVE keys first, fall back to generic keys
      publicKey = Deno.env.get('MAISHAPAY_LIVE_PUBLIC_KEY') || 
                  Deno.env.get('MAISHAPAY_PUBLIC_KEY') || 
                  Deno.env.get('MAISHA_PUBLIC_KEY') || '';
      secretKey = Deno.env.get('MAISHAPAY_LIVE_SECRET_KEY') || 
                  Deno.env.get('MAISHAPAY_SECRET_KEY') || 
                  Deno.env.get('MAISHA_SECRET_KEY') || '';
    } else {
      // Sandbox mode - use SANDBOX keys first, fall back to generic keys
      publicKey = Deno.env.get('MAISHAPAY_SANDBOX_PUBLIC_KEY') || 
                  Deno.env.get('MAISHAPAY_PUBLIC_KEY') || 
                  Deno.env.get('MAISHA_PUBLIC_KEY') || '';
      secretKey = Deno.env.get('MAISHAPAY_SANDBOX_SECRET_KEY') || 
                  Deno.env.get('MAISHAPAY_SECRET_KEY') || 
                  Deno.env.get('MAISHA_SECRET_KEY') || '';
    }
    
    // Get callback URL - this is where MaishaPay redirects after payment
    const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';
    const callbackUrl = Deno.env.get('MAISHAPAY_CALLBACK_URL') || `${frontendBaseUrl}/maishapay/result`;
    
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
    
    if (!secretKey) {
      console.error('[maishapay-get-config] Missing secret key');
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: 'Payment gateway not configured: missing secret key' 
        }),
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log('[maishapay-get-config] Returning config:', {
      mode: isLiveMode ? 'live' : 'sandbox',
      gatewayMode: isLiveMode ? '1' : '0',
      hasPublicKey: !!publicKey,
      hasSecretKey: !!secretKey,
      publicKeyPrefix: publicKey?.slice(0, 10) + '...',
      callbackUrl,
    });

    return new Response(
      JSON.stringify({
        success: true,
        gatewayMode: isLiveMode ? '1' : '0',
        publicApiKey: publicKey,
        secretApiKey: secretKey,
        callbackUrl,
        mode: isLiveMode ? 'live' : 'sandbox',
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
