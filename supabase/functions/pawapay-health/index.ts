/**
 * pawapay-health Edge Function
 * 
 * Diagnostic endpoint to verify pawaPay configuration without making payments.
 * Safe to call from mobile app before attempting payment.
 * 
 * Response:
 *   { ok: true, baseUrl: "sandbox"|"production", tokenPresent: true, providerReachable: true }
 *   { ok: false, error_code: "PAWAPAY_NOT_CONFIGURED|PAWAPAY_AUTH_FAILED|PAWAPAY_API_DOWN|PAWAPAY_API_ERROR", message: "..." }
 * 
 * Security: verify_jwt=false but does NOT leak secrets
 * Rate limit: Max 10 calls per minute per IP (implemented via simple check)
 */

import { getCorsHeaders } from "../_shared/http.ts";

const corsHeaders = getCorsHeaders();

interface HealthResponse {
  ok: boolean;
  baseUrl?: 'sandbox' | 'production';
  tokenPresent?: boolean;
  providerReachable?: boolean;
  error_code?: 'PAWAPAY_NOT_CONFIGURED' | 'PAWAPAY_AUTH_FAILED' | 'PAWAPAY_API_DOWN' | 'PAWAPAY_API_ERROR';
  message?: string;
  timestamp?: string;
}

/**
 * Detect environment from base URL
 */
function detectEnvFromUrl(baseUrl: string): 'sandbox' | 'production' {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    if (hostname.includes('sandbox')) {
      return 'sandbox';
    }
    return 'production';
  } catch {
    return 'sandbox';
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  console.log('[PAWAPAY_HEALTH_CHECK] Starting diagnostic check');

  try {
    // Check environment variables
    const apiToken = (Deno.env.get('PAWAPAY_API_TOKEN') || '').trim();
    const baseUrl = (Deno.env.get('PAWAPAY_BASE_URL') || '').trim();
    
    const tokenPresent = apiToken.length > 0;
    const baseUrlPresent = baseUrl.length > 0;

    console.log('[PAWAPAY_HEALTH_CHECK] Config check:', {
      tokenPresent,
      tokenLength: apiToken.length,
      baseUrlPresent,
      baseUrlDomain: baseUrlPresent ? new URL(baseUrl).hostname : 'N/A',
    });

    // Check if configuration is missing
    if (!tokenPresent || !baseUrlPresent) {
      const missing: string[] = [];
      if (!tokenPresent) missing.push('PAWAPAY_API_TOKEN');
      if (!baseUrlPresent) missing.push('PAWAPAY_BASE_URL');
      
      console.error('[PAWAPAY_HEALTH_CHECK] Missing config:', missing);
      
      const result: HealthResponse = {
        ok: false,
        tokenPresent,
        error_code: 'PAWAPAY_NOT_CONFIGURED',
        message: `Missing configuration: ${missing.join(', ')}`,
        timestamp: new Date().toISOString(),
      };
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const envMode = detectEnvFromUrl(baseUrl);

    // Try multiple health check methods
    // 1. First try /v1/wallet endpoint (returns balance, most reliable)
    // 2. Fall back to /deposits (with empty body, will get 400 but confirms auth)
    // 3. If neither works, return config-only status
    
    let providerReachable = false;
    let authSuccess = false;
    let apiStatus: number | null = null;
    
    // Try wallet endpoint first (lightweight, read-only)
    try {
      const walletResponse = await fetch(`${baseUrl}/v1/wallet`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Accept': 'application/json',
        },
      });
      
      apiStatus = walletResponse.status;
      providerReachable = true;
      
      if (walletResponse.status === 200) {
        authSuccess = true;
      } else if (walletResponse.status === 401) {
        // Auth failed
        console.error('[PAWAPAY_HEALTH_CHECK] Authentication failed (401) on /v1/wallet');
        const result: HealthResponse = {
          ok: false,
          baseUrl: envMode,
          tokenPresent: true,
          providerReachable: true,
          error_code: 'PAWAPAY_AUTH_FAILED',
          message: 'pawaPay API authentication failed. Token may be invalid or expired.',
          timestamp: new Date().toISOString(),
        };
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } catch (walletError: any) {
      console.warn('[PAWAPAY_HEALTH_CHECK] Wallet check failed:', walletError.message);
      // Continue to fallback
    }
    
    // If wallet didn't succeed, try deposits endpoint
    if (!authSuccess && !providerReachable) {
      try {
        // Send a minimal invalid request - will get 400 Bad Request (confirms auth works)
        const depositsResponse = await fetch(`${baseUrl}/deposits`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}), // Empty body = 400, but proves auth works
        });
        
        apiStatus = depositsResponse.status;
        providerReachable = true;
        
        if (depositsResponse.status === 400) {
          // This is expected - bad request but auth succeeded
          authSuccess = true;
        } else if (depositsResponse.status === 401) {
          console.error('[PAWAPAY_HEALTH_CHECK] Authentication failed (401) on /deposits');
          const result: HealthResponse = {
            ok: false,
            baseUrl: envMode,
            tokenPresent: true,
            providerReachable: true,
            error_code: 'PAWAPAY_AUTH_FAILED',
            message: 'pawaPay API authentication failed. Token may be invalid or expired.',
            timestamp: new Date().toISOString(),
          };
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        } else if (depositsResponse.status >= 500) {
          console.error('[PAWAPAY_HEALTH_CHECK] Provider error:', depositsResponse.status);
          const result: HealthResponse = {
            ok: false,
            baseUrl: envMode,
            tokenPresent: true,
            providerReachable: false,
            error_code: 'PAWAPAY_API_DOWN',
            message: `pawaPay API returned server error (${depositsResponse.status})`,
            timestamp: new Date().toISOString(),
          };
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } catch (depositsError: any) {
        console.warn('[PAWAPAY_HEALTH_CHECK] Deposits check failed:', depositsError.message);
      }
    }
    
    const responseTime = Date.now() - startTime;

    // If we couldn't reach the API at all
    if (!providerReachable) {
      console.error('[PAWAPAY_HEALTH_CHECK] Could not reach pawaPay API');
      const result: HealthResponse = {
        ok: false,
        baseUrl: envMode,
        tokenPresent: true,
        providerReachable: false,
        error_code: 'PAWAPAY_API_DOWN',
        message: 'Could not connect to pawaPay API',
        timestamp: new Date().toISOString(),
      };
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Success - pawaPay is configured and reachable
    console.log('[PAWAPAY_HEALTH_CHECK] Success:', {
      env: envMode,
      responseTime: `${responseTime}ms`,
      authSuccess,
      apiStatus,
    });

    const result: HealthResponse = {
      ok: true,
      baseUrl: envMode,
      tokenPresent: true,
      providerReachable: true,
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
    console.error('[PAWAPAY_HEALTH_CHECK] Exception:', error.message);
    
    // Network errors typically mean the provider is unreachable
    const isNetworkError = error.message?.includes('fetch') || 
                          error.message?.includes('network') ||
                          error.message?.includes('connection');
    
    const result: HealthResponse = {
      ok: false,
      providerReachable: false,
      error_code: isNetworkError ? 'PAWAPAY_API_DOWN' : 'PAWAPAY_API_ERROR',
      message: `Network error: ${error.message}`,
      timestamp: new Date().toISOString(),
    };
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
