/**
 * Admin: Set Active Payment Provider
 * 
 * Sets a payment provider as the default (active) provider for new payments.
 * Validates that the provider is enabled and has all required secrets configured.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/http.ts";

const corsHeaders = getCorsHeaders();
import { validateProviderSecrets, getProviderByKey } from "../_shared/paymentProviders.ts";

interface RequestBody {
  provider_code: string;
}

interface ResponseBody {
  success: boolean;
  message?: string;
  error?: string;
  error_code?: string;
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
        JSON.stringify({ success: false, error: 'Authorization required', error_code: 'AUTH_REQUIRED' }),
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
        JSON.stringify({ success: false, error: 'Invalid authentication', error_code: 'INVALID_AUTH' }),
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
        JSON.stringify({ success: false, error: 'Admin access required', error_code: 'NOT_ADMIN' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request
    const body: RequestBody = await req.json();
    const { provider_code } = body;

    if (!provider_code) {
      return new Response(
        JSON.stringify({ success: false, error: 'provider_code is required', error_code: 'MISSING_PROVIDER' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[admin-set-active-provider] Setting active provider:', provider_code);

    // Fetch provider
    const provider = await getProviderByKey(supabaseAdmin, provider_code);

    if (!provider) {
      return new Response(
        JSON.stringify({ success: false, error: `Provider '${provider_code}' not found`, error_code: 'PROVIDER_NOT_FOUND' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if enabled
    if (!provider.is_enabled) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Provider '${provider.display_name}' is disabled. Enable it first.`,
          error_code: 'PROVIDER_DISABLED'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate secrets
    const secretsCheck = validateProviderSecrets(provider);
    if (!secretsCheck.valid) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Provider '${provider.display_name}' is missing required secrets: ${secretsCheck.missing.join(', ')}`,
          error_code: 'MISSING_SECRETS'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for coming_soon status
    if (provider.config_public?.status === 'coming_soon') {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Provider '${provider.display_name}' is not yet available (coming soon)`,
          error_code: 'PROVIDER_COMING_SOON'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Set as default (trigger will unset others)
    const { error: updateError } = await supabaseAdmin
      .from('payment_providers')
      .update({ 
        is_default: true,
        updated_at: new Date().toISOString(),
      })
      .eq('provider_key', provider_code);

    if (updateError) {
      console.error('[admin-set-active-provider] Update error:', updateError.message);
      return new Response(
        JSON.stringify({ success: false, error: 'Failed to update provider', error_code: 'UPDATE_FAILED' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('[admin-set-active-provider] Successfully set active provider:', provider_code);

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: `${provider.display_name} is now the active payment provider` 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('[admin-set-active-provider] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Internal server error', error_code: 'INTERNAL_ERROR' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
