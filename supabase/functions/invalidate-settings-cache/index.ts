// Admin endpoint to force-invalidate settings cache
// Call this after updating fees/settings in admin panel for immediate effect

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse,
  createAdminClient
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

    // Invalidate in-memory caches (this instance only)
    invalidateSettingsCache();
    invalidateCatalogSettingsCache();

    // Wipe persisted priced-output caches so new markup/shipping take effect
    // immediately across homepage, search, category, collection and hot feeds.
    // We do NOT touch upstream raw-price caches (price_cache, price_capture_cache,
    // product_cache) because markup changes don't invalidate the source price.
    const cacheTables = [
      'catalog_home_cache',
      'catalog_home_mobile_sections_cache',
      'catalog_cache',
      'catalog_search_cache',
      'catalog_collection_cache',
      'catalog_facets_cache',
      'home_cache_web_feed',
      'home_cache_mobile_sections',
      'product_hot_cache',
      'search_proxy_cache',
    ];

    // Wipe with the service-role client: these cache tables are no longer
    // writable through a visitor/admin session (RLS + grants are internal-only).
    const admin = createAdminClient();
    const wipeResults: Record<string, string> = {};
    await Promise.all(
      cacheTables.map(async (t) => {
        const { error } = await admin
          .from(t)
          .delete()
          .gte('created_at', '1900-01-01');
        if (error) {
          // Fallback for tables without created_at — match all by primary key
          const { error: e2 } = await admin.from(t).delete().not('id', 'is', null);
          wipeResults[t] = e2 ? `error: ${e2.message}` : 'wiped';
        } else {
          wipeResults[t] = 'wiped';
        }
      })
    );

    console.log('[invalidate-settings-cache] Cache invalidated by admin:', user.id, wipeResults);

    // Log the action
    await supabase.from('admin_audit_logs').insert({
      admin_id: user.id,
      action_type: 'INVALIDATE_SETTINGS_CACHE',
      target_section: 'settings',
      details: { timestamp: new Date().toISOString(), wipeResults },
    });

    return jsonResponse({
      success: true,
      message: 'Settings cache invalidated. Priced caches wiped — new values active immediately.',
      wipeResults,
    });


  } catch (error: any) {
    console.error('[invalidate-settings-cache] Error:', error);
    return errorResponse(error.message, error.status || 500);
  }
});
