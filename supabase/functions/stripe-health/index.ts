/**
 * stripe-health Edge Function
 * 
 * Diagnostic endpoint to verify Stripe configuration without making payments.
 * Safe to call from mobile app before attempting payment.
 * 
 * Response:
 *   { ok: true, mode: "test"|"live", canCreatePaymentIntent: true }
 *   { ok: false, error_code: "STRIPE_NOT_CONFIGURED|STRIPE_AUTH_FAILED|STRIPE_API_ERROR", message: "..." }
 * 
 * Security: verify_jwt=false but does NOT leak secrets
 */

import { getCorsHeaders } from "../_shared/http.ts";

const corsHeaders = getCorsHeaders();

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

interface HealthResponse {
  ok: boolean;
  mode?: 'test' | 'live';
  canCreatePaymentIntent?: boolean;
  error_code?: 'STRIPE_NOT_CONFIGURED' | 'STRIPE_AUTH_FAILED' | 'STRIPE_API_ERROR';
  message?: string;
  timestamp?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('[STRIPE_HEALTH_CHECK] Starting diagnostic check');

  try {
    // Check if STRIPE_SECRET_KEY is configured
    const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
    
    if (!secretKey || secretKey.trim().length === 0) {
      console.error('[STRIPE_HEALTH_CHECK] STRIPE_SECRET_KEY not configured');
      const response: HealthResponse = {
        ok: false,
        error_code: 'STRIPE_NOT_CONFIGURED',
        message: 'Stripe secret key is not configured in environment secrets',
        timestamp: new Date().toISOString(),
      };
      return new Response(JSON.stringify(response), {
        status: 200, // Return 200 for diagnostics
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Detect mode from key prefix
    const isTestMode = secretKey.startsWith('sk_test_');
    const isLiveMode = secretKey.startsWith('sk_live_');
    const mode: 'test' | 'live' = isTestMode ? 'test' : 'live';

    console.log('[STRIPE_HEALTH_CHECK] Key detected:', {
      mode,
      keyLength: secretKey.length,
      keyPrefix: secretKey.slice(0, 8) + '...',
    });

    // Make a lightweight API call to verify credentials
    // Using /balance which is read-only and safe
    const response = await fetch(`${STRIPE_API_BASE}/balance`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
      },
    });

    const responseTime = Date.now() - startTime;

    if (response.status === 401) {
      console.error('[STRIPE_HEALTH_CHECK] Authentication failed (401)');
      const result: HealthResponse = {
        ok: false,
        mode,
        error_code: 'STRIPE_AUTH_FAILED',
        message: 'Stripe API authentication failed. Check if the secret key is valid.',
        timestamp: new Date().toISOString(),
      };
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[STRIPE_HEALTH_CHECK] API error:', response.status, errorData);
      const result: HealthResponse = {
        ok: false,
        mode,
        error_code: 'STRIPE_API_ERROR',
        message: errorData?.error?.message || `Stripe API returned status ${response.status}`,
        timestamp: new Date().toISOString(),
      };
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Success - Stripe is configured and reachable
    const balanceData = await response.json();
    
    console.log('[STRIPE_HEALTH_CHECK] Success:', {
      mode,
      responseTime: `${responseTime}ms`,
      hasBalance: !!balanceData.available,
    });

    const result: HealthResponse = {
      ok: true,
      mode,
      canCreatePaymentIntent: true,
      timestamp: new Date().toISOString(),
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 
        ...corsHeaders, 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store, max-age=0',
      },
    });

  } catch (error: any) {
    console.error('[STRIPE_HEALTH_CHECK] Exception:', error.message);
    const result: HealthResponse = {
      ok: false,
      error_code: 'STRIPE_API_ERROR',
      message: `Network error: ${error.message}`,
      timestamp: new Date().toISOString(),
    };
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
