/**
 * update-payment-provider Edge Function
 * 
 * Updates payment provider settings (enable/disable, default, priority, etc.)
 * Admin only. Does NOT allow setting secret values.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse,
  createAdminClient,
} from "../_shared/auth.ts";
import { getProviderByKey, validateProviderSecrets } from "../_shared/paymentProviders.ts";
import { logAudit, generateTraceId } from "../_shared/auditLog.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST' && req.method !== 'PATCH') {
    return errorResponse('Method not allowed', 405);
  }

  const traceId = generateTraceId();

  try {
    // Authenticate user
    const { user, supabase } = await verifyAndGetUser(req);

    // Check if user is admin
    const { data: adminRole } = await supabase
      .from('user_roles')
      .select('role, admin_role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (!adminRole) {
      return errorResponse('Admin access required', 403);
    }

    // Parse request body
    const body = await req.json();
    const { 
      provider_key, 
      is_enabled, 
      is_default, 
      priority,
      supported_countries,
      supported_methods,
      config_public,
    } = body;

    if (!provider_key) {
      return errorResponse('provider_key is required', 400);
    }

    const adminClient = createAdminClient();

    // Verify provider exists
    const existingProvider = await getProviderByKey(adminClient, provider_key);
    if (!existingProvider) {
      return errorResponse('Provider not found', 404);
    }

    // Build update object
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof is_enabled === 'boolean') {
      // If enabling, check secrets are configured
      if (is_enabled && !existingProvider.is_enabled) {
        const secretsValidation = validateProviderSecrets(existingProvider);
        if (!secretsValidation.valid) {
          return jsonResponse({
            success: false,
            error: 'Cannot enable provider: missing secrets',
            missing_secrets: secretsValidation.missing,
          }, 400);
        }
      }
      updateData.is_enabled = is_enabled;
    }

    if (typeof is_default === 'boolean') {
      updateData.is_default = is_default;
      // Note: The database trigger will unset other defaults
    }

    if (typeof priority === 'number') {
      updateData.priority = priority;
    }

    if (Array.isArray(supported_countries)) {
      updateData.supported_countries = supported_countries;
    }

    if (Array.isArray(supported_methods)) {
      updateData.supported_methods = supported_methods;
    }

    if (config_public && typeof config_public === 'object') {
      // Merge with existing config
      updateData.config_public = {
        ...existingProvider.config_public,
        ...config_public,
      };
    }

    // Perform update
    const { data: updatedProvider, error: updateError } = await adminClient
      .from('payment_providers')
      .update(updateData)
      .eq('provider_key', provider_key)
      .select()
      .single();

    if (updateError) {
      console.error('[update-payment-provider] Update error:', updateError);
      return errorResponse('Failed to update provider', 500);
    }

    // Log audit
    await logAudit(adminClient, {
      traceId,
      eventType: 'PAYMENT_PROVIDER_UPDATED',
      userId: user.id,
      payload: {
        provider_key,
        changes: updateData,
        updated_by: user.email,
      },
    });

    console.log('[update-payment-provider] Provider updated:', provider_key);

    return jsonResponse({
      success: true,
      provider: updatedProvider,
    });

  } catch (error: any) {
    console.error('[update-payment-provider] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return errorResponse('Internal server error', 500);
  }
});
