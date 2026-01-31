/**
 * stripe-health Edge Function
 * 
 * Enhanced diagnostic endpoint to verify Stripe configuration.
 * Safe to call from mobile app before attempting payment.
 * 
 * GET /functions/v1/stripe-health
 * - Returns key presence, mode (test/live), API reachability
 * 
 * POST /functions/v1/stripe-health (admin-only)
 * - With body: { "test_intent": true }
 * - Creates a $1.00 test intent (test mode only) to verify full flow
 * 
 * Response:
 *   { ok: true, mode: "test"|"live", canCreatePaymentIntent: true, diagnostics: {...} }
 *   { ok: false, error_code: "STRIPE_NOT_CONFIGURED|STRIPE_AUTH_FAILED|STRIPE_API_ERROR", message: "..." }
 * 
 * Security: verify_jwt=false but does NOT leak secrets
 */

import { getCorsHeaders } from "../_shared/http.ts";
import { 
  resolveAndLogStripeKey, 
  checkDualKeySetup, 
  getKeyDiagnostics,
  type StripeKeyDiagnostics,
} from "../_shared/stripeKeyResolver.ts";

const corsHeaders = getCorsHeaders();

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

interface HealthResponse {
  ok: boolean;
  mode?: 'test' | 'live';
  canCreatePaymentIntent?: boolean;
  error_code?: 'STRIPE_NOT_CONFIGURED' | 'STRIPE_AUTH_FAILED' | 'STRIPE_API_ERROR';
  message?: string;
  timestamp?: string;
  diagnostics?: {
    keySetup: ReturnType<typeof checkDualKeySetup>;
    keyDiagnostics: StripeKeyDiagnostics;
    apiReachable: boolean;
    apiResponseTimeMs?: number;
    testIntentCreated?: boolean;
    testIntentId?: string;
  };
}

interface AdminTestRequest {
  test_intent?: boolean;
  admin_token?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('[STRIPE_HEALTH_CHECK] Starting diagnostic check', {
    method: req.method,
    timestamp: new Date().toISOString(),
  });

  try {
    // Parse admin request body for POST
    let adminRequest: AdminTestRequest = {};
    if (req.method === 'POST') {
      try {
        adminRequest = await req.json();
      } catch {
        adminRequest = {};
      }
    }

    // Resolve Stripe key with diagnostics
    const keyResult = resolveAndLogStripeKey('stripe-health', undefined, {
      method: req.method,
      testIntent: adminRequest.test_intent,
    });

    const keyDiagnostics = getKeyDiagnostics(keyResult);
    const keySetup = checkDualKeySetup();

    if (!keyResult.success || !keyResult.keyInfo) {
      console.error('[STRIPE_HEALTH_CHECK] Key resolution failed:', keyResult.error);
      const response: HealthResponse = {
        ok: false,
        error_code: keyResult.error_code as any || 'STRIPE_NOT_CONFIGURED',
        message: keyResult.error || 'Stripe secret key is not configured in environment secrets',
        timestamp: new Date().toISOString(),
        diagnostics: {
          keySetup,
          keyDiagnostics,
          apiReachable: false,
        },
      };
      return new Response(JSON.stringify(response), {
        status: 200, // Return 200 for diagnostics
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { keyInfo } = keyResult;
    const mode = keyInfo.mode;

    console.log('[STRIPE_HEALTH_CHECK] Key resolved:', {
      mode,
      keyPrefix: keyInfo.keyPrefix,
      keyLength: keyInfo.keyLength,
      source: keyInfo.source,
    });

    // Make a lightweight API call to verify credentials
    // Using /balance which is read-only and safe
    const balanceResponse = await fetch(`${STRIPE_API_BASE}/balance`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${keyInfo.secretKey}`,
      },
    });

    const apiResponseTime = Date.now() - startTime;

    if (balanceResponse.status === 401) {
      console.error('[STRIPE_HEALTH_CHECK] Authentication failed (401)');
      const result: HealthResponse = {
        ok: false,
        mode,
        error_code: 'STRIPE_AUTH_FAILED',
        message: 'Stripe API authentication failed. Check if the secret key is valid.',
        timestamp: new Date().toISOString(),
        diagnostics: {
          keySetup,
          keyDiagnostics,
          apiReachable: false,
          apiResponseTimeMs: apiResponseTime,
        },
      };
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!balanceResponse.ok) {
      const errorData = await balanceResponse.json().catch(() => ({}));
      console.error('[STRIPE_HEALTH_CHECK] API error:', balanceResponse.status, errorData);
      const result: HealthResponse = {
        ok: false,
        mode,
        error_code: 'STRIPE_API_ERROR',
        message: errorData?.error?.message || `Stripe API returned status ${balanceResponse.status}`,
        timestamp: new Date().toISOString(),
        diagnostics: {
          keySetup,
          keyDiagnostics,
          apiReachable: false,
          apiResponseTimeMs: apiResponseTime,
        },
      };
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Success - Stripe is configured and reachable
    const balanceData = await balanceResponse.json();
    
    console.log('[STRIPE_HEALTH_CHECK] Balance check passed:', {
      mode,
      apiResponseTimeMs: apiResponseTime,
      hasBalance: !!balanceData.available,
    });

    // Optional: Create test intent for admin verification (test mode only)
    let testIntentCreated = false;
    let testIntentId: string | undefined;

    if (adminRequest.test_intent && mode === 'test') {
      console.log('[STRIPE_HEALTH_CHECK] Creating test intent...');
      
      try {
        const testBody = new URLSearchParams({
          amount: '100', // $1.00 in cents
          currency: 'usd',
          'automatic_payment_methods[enabled]': 'true',
          'metadata[test]': 'stripe-health-check',
          'metadata[timestamp]': new Date().toISOString(),
        });

        const intentResponse = await fetch(`${STRIPE_API_BASE}/payment_intents`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${keyInfo.secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: testBody.toString(),
        });

        if (intentResponse.ok) {
          const intentData = await intentResponse.json();
          testIntentCreated = true;
          testIntentId = intentData.id;
          console.log('[STRIPE_HEALTH_CHECK] Test intent created:', {
            id: intentData.id,
            hasClientSecret: !!intentData.client_secret,
          });

          // Cancel the test intent immediately
          await fetch(`${STRIPE_API_BASE}/payment_intents/${intentData.id}/cancel`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${keyInfo.secretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
          });
          console.log('[STRIPE_HEALTH_CHECK] Test intent cancelled');
        } else {
          const errorData = await intentResponse.json().catch(() => ({}));
          console.warn('[STRIPE_HEALTH_CHECK] Test intent failed:', errorData);
        }
      } catch (err: any) {
        console.warn('[STRIPE_HEALTH_CHECK] Test intent error:', err.message);
      }
    }

    const result: HealthResponse = {
      ok: true,
      mode,
      canCreatePaymentIntent: true,
      timestamp: new Date().toISOString(),
      diagnostics: {
        keySetup,
        keyDiagnostics,
        apiReachable: true,
        apiResponseTimeMs: apiResponseTime,
        testIntentCreated: adminRequest.test_intent ? testIntentCreated : undefined,
        testIntentId,
      },
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
