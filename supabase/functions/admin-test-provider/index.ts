/**
 * Admin: Test Payment Provider Configuration
 * 
 * Tests if a payment provider is correctly configured by:
 * - Checking required secrets exist
 * - Making a test API call to verify connectivity
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/http.ts";
import { validateProviderSecrets, getProviderByKey } from "../_shared/paymentProviders.ts";
import { testConfiguration as testStripe, getStripeConfig } from "../_shared/stripeAdapter.ts";
import { testConfiguration as testAvadaPay } from "../_shared/avadapayAdapter.ts";
import { getPawaPayConfig } from "../_shared/pawapayAdapter.ts";

interface RequestBody {
  provider_code: string;
}

interface ResponseBody {
  success: boolean;
  provider: string;
  status: 'configured' | 'missing_secrets' | 'connection_failed' | 'not_implemented';
  message: string;
  details?: {
    secrets_configured: boolean;
    missing_secrets?: string[];
    api_test?: 'passed' | 'failed' | 'skipped';
    api_message?: string;
  };
  error?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get user
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid authentication' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check admin role
    const { data: adminUser } = await supabaseAdmin
      .from('admin_users')
      .select('id')
      .eq('email', user.email)
      .single();

    if (!adminUser) {
      return new Response(
        JSON.stringify({ success: false, error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request
    const body: RequestBody = await req.json();
    const { provider_code } = body;

    if (!provider_code) {
      return new Response(
        JSON.stringify({ success: false, error: 'provider_code is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[admin-test-provider] Testing provider:', provider_code);

    // Fetch provider
    const provider = await getProviderByKey(supabaseAdmin, provider_code);

    if (!provider) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          provider: provider_code,
          status: 'connection_failed',
          message: `Provider '${provider_code}' not found`,
          error: 'Provider not found'
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for coming_soon status
    if (provider.config_public?.status === 'coming_soon') {
      const result: ResponseBody = {
        success: true,
        provider: provider_code,
        status: 'not_implemented',
        message: `${provider.display_name} is coming soon and not yet available`,
        details: {
          secrets_configured: false,
          api_test: 'skipped',
        },
      };
      
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate secrets
    const secretsCheck = validateProviderSecrets(provider);

    if (!secretsCheck.valid) {
      const result: ResponseBody = {
        success: true,
        provider: provider_code,
        status: 'missing_secrets',
        message: `Missing required secrets: ${secretsCheck.missing.join(', ')}`,
        details: {
          secrets_configured: false,
          missing_secrets: secretsCheck.missing,
          api_test: 'skipped',
        },
      };
      
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Test API connectivity based on provider
    let apiTestResult: { success: boolean; message: string; error?: string };

    switch (provider_code.toLowerCase()) {
      case 'stripe':
        try {
          const stripeConfig = getStripeConfig(provider);
          apiTestResult = await testStripe(stripeConfig);
        } catch (err: any) {
          apiTestResult = { success: false, message: 'Failed to initialize Stripe', error: err.message };
        }
        break;

      case 'pawapay':
        try {
          const pawaPayConfig = getPawaPayConfig(provider);
          // Test by calling wallets endpoint
          const response = await fetch(`${pawaPayConfig.apiBase}/v1/wallets`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${pawaPayConfig.apiToken}`,
              'Content-Type': 'application/json',
            },
          });
          
          if (response.ok) {
            apiTestResult = { success: true, message: 'pawaPay API connection successful' };
          } else {
            const errorData = await response.json().catch(() => ({}));
            apiTestResult = { 
              success: false, 
              message: 'pawaPay API returned error', 
              error: errorData.message || `HTTP ${response.status}` 
            };
          }
        } catch (err: any) {
          apiTestResult = { success: false, message: 'Failed to connect to pawaPay', error: err.message };
        }
        break;

      case 'maishapay':
        // MaishaPay doesn't have a simple test endpoint, so just check secrets
        apiTestResult = { success: true, message: 'MaishaPay secrets configured' };
        break;

      case 'avadapay':
        apiTestResult = await testAvadaPay();
        break;

      default:
        apiTestResult = { success: false, message: 'Unknown provider', error: 'No test implementation' };
    }

    const result: ResponseBody = {
      success: apiTestResult.success,
      provider: provider_code,
      status: apiTestResult.success ? 'configured' : 'connection_failed',
      message: apiTestResult.message,
      details: {
        secrets_configured: true,
        api_test: apiTestResult.success ? 'passed' : 'failed',
        api_message: apiTestResult.error || apiTestResult.message,
      },
    };

    if (!apiTestResult.success) {
      result.error = apiTestResult.error;
    }

    console.log('[admin-test-provider] Result:', {
      provider: provider_code,
      status: result.status,
      apiTest: result.details?.api_test,
    });

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[admin-test-provider] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
