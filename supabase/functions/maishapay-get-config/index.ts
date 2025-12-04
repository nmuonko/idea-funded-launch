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
    const mode = Deno.env.get('MAISHAPAY_MODE');
    const isSandbox = mode !== '1' && mode?.toLowerCase() !== 'live';
    
    // Get keys based on mode
    let publicKey: string;
    let secretKey: string;
    
    if (isSandbox) {
      publicKey = Deno.env.get('MAISHAPAY_SANDBOX_PUBLIC_KEY') || 
                  Deno.env.get('MAISHAPAY_PUBLIC_KEY') || 
                  Deno.env.get('MAISHA_PUBLIC_KEY') || '';
      secretKey = Deno.env.get('MAISHAPAY_SANDBOX_SECRET_KEY') || 
                  Deno.env.get('MAISHAPAY_SECRET_KEY') || 
                  Deno.env.get('MAISHA_SECRET_KEY') || '';
    } else {
      publicKey = Deno.env.get('MAISHAPAY_LIVE_PUBLIC_KEY') || 
                  Deno.env.get('MAISHAPAY_PUBLIC_KEY') || '';
      secretKey = Deno.env.get('MAISHAPAY_LIVE_SECRET_KEY') || 
                  Deno.env.get('MAISHAPAY_SECRET_KEY') || '';
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
      mode: isSandbox ? 'sandbox' : 'live',
      gatewayMode: isSandbox ? '0' : '1',
      hasPublicKey: !!publicKey,
      hasSecretKey: !!secretKey,
      callbackUrl,
    });

    return new Response(
      JSON.stringify({
        success: true,
        gatewayMode: isSandbox ? '0' : '1',
        publicApiKey: publicKey,
        secretApiKey: secretKey,
        callbackUrl,
        mode: isSandbox ? 'sandbox' : 'live',
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
