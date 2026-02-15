// Admin endpoint to force-invalidate settings cache
// Call this after updating fees/settings in admin panel for immediate effect

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";
import { invalidateSettingsCache } from "../_shared/settings-cache.ts";
import { invalidateCatalogSettingsCache } from "../_shared/catalogSettings.ts";

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Verify admin access
    const { user, supabase } = await verifyAndGetUser(req);
    
    // Check if user is admin
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (!roleData) {
      return errorResponse('Admin access required', 403);
    }

    // Invalidate the cache
    invalidateSettingsCache();
    invalidateCatalogSettingsCache();

    console.log('[invalidate-settings-cache] Cache invalidated by admin:', user.id);

    // Log the action
    await supabase.from('admin_audit_logs').insert({
      admin_id: user.id,
      action_type: 'INVALIDATE_SETTINGS_CACHE',
      target_section: 'settings',
      details: { timestamp: new Date().toISOString() },
    });

    return jsonResponse({
      success: true,
      message: 'Settings cache invalidated. New values will be loaded on next request.',
    });

  } catch (error: any) {
    console.error('[invalidate-settings-cache] Error:', error);
    return errorResponse(error.message, error.status || 500);
  }
});
