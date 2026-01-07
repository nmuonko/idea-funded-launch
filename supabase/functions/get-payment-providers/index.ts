/**
 * get-payment-providers Edge Function
 * 
 * Returns list of all payment providers for admin management.
 * Does NOT return actual secret values, only references.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse,
  createAdminClient,
} from "../_shared/auth.ts";
import { getAllProviders, validateProviderSecrets } from "../_shared/paymentProviders.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate user
    const { user, supabase } = await verifyAndGetUser(req);

    // Check if user is admin
    const { data: adminRole } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (!adminRole) {
      return errorResponse('Admin access required', 403);
    }

    const adminClient = createAdminClient();
    const providers = await getAllProviders(adminClient);

    // Enhance providers with secrets validation status
    const enhancedProviders = providers.map(provider => {
      const secretsValidation = validateProviderSecrets(provider);
      
      return {
        ...provider,
        secrets_configured: secretsValidation.valid,
        missing_secrets: secretsValidation.missing,
        // Never return actual secret values
        secret_refs: Object.keys(provider.secret_refs).reduce((acc, key) => {
          acc[key] = {
            ref: provider.secret_refs[key],
            configured: !secretsValidation.missing.includes(key),
          };
          return acc;
        }, {} as Record<string, { ref: string; configured: boolean }>),
      };
    });

    return jsonResponse({
      success: true,
      providers: enhancedProviders,
    });

  } catch (error: any) {
    console.error('[get-payment-providers] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return errorResponse('Internal server error', 500);
  }
});
