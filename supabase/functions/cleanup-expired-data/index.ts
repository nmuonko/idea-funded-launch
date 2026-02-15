import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { verifyCronAuth, cronAuthErrorResponse } from "../_shared/cronAuth.ts";
import { generateTraceId, logAuditEvent, createTracedLogger } from "../_shared/auditLog.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

/**
 * cleanup-expired-data Edge Function
 * Scheduled job to clean up ALL expired records across cache tables
 * 
 * REQUIRES: x-cron-secret header matching CRON_SECRET env var
 * 
 * Tables cleaned:
 * - catalog_cache (with 1hr buffer for stale-while-revalidate)
 * - catalog_rate_limits (older than 2 hours)
 * - rate_limits (expired)
 * - product_cache (expired)
 * - product_hot_cache (expired)
 * - provider_budget (older than 48 hours)
 * - payment_attempts (mark expired as 'expired')
 * - home_seen_items (older than 7 days)
 * - guest_cart_snapshots (older than 30 days)
 * - catalog_facets_cache (expired)
 * - product_variants_cache (expired)
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const traceId = generateTraceId();
  const log = createTracedLogger(traceId);

  log.log('cleanup-expired-data started (comprehensive)');

  // Verify cron authentication
  const cronAuth = verifyCronAuth(req);
  if (!cronAuth.authorized) {
    log.error('Cron auth failed', { error: cronAuth.error });
    return cronAuthErrorResponse(cronAuth.error || 'Unauthorized');
  }

  try {
    // Use service role for database operations
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    log.log('Calling cleanup_all_expired_data RPC');

    // Call the comprehensive cleanup RPC function
    const { data, error } = await supabase.rpc('cleanup_all_expired_data');

    if (error) {
      log.error('Cleanup RPC failed', { error: error.message });
      
      await logAuditEvent(supabase, traceId, 'CLEANUP_COMPLETED', {
        errorMessage: error.message,
        durationMs: Date.now() - startTime,
      });

      return new Response(
        JSON.stringify({
          ok: false,
          success: false,
          error: error.message,
          duration: Date.now() - startTime,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const result = data as {
      success: boolean;
      catalog_cache_deleted: number;
      catalog_rate_limits_deleted: number;
      rate_limits_deleted: number;
      product_cache_deleted: number;
      product_hot_cache_deleted: number;
      provider_budget_deleted: number;
      payment_attempts_expired: number;
      home_seen_items_deleted: number;
      guest_cart_snapshots_deleted: number;
      catalog_facets_cache_deleted: number;
      variants_cache_deleted: number;
      translation_cache_deleted: number;
      duration_ms: number;
      cleanup_at: string;
    };

    // Calculate total records cleaned
    const totalCleaned = 
      result.catalog_cache_deleted +
      result.catalog_rate_limits_deleted +
      result.rate_limits_deleted +
      result.product_cache_deleted +
      result.product_hot_cache_deleted +
      result.provider_budget_deleted +
      result.payment_attempts_expired +
      result.home_seen_items_deleted +
      result.guest_cart_snapshots_deleted +
      result.catalog_facets_cache_deleted +
      result.variants_cache_deleted +
      result.translation_cache_deleted;

    log.log('Cleanup completed', { ...result, totalCleaned });

    // Log to audit
    await logAuditEvent(supabase, traceId, 'CLEANUP_COMPLETED', {
      payload: { ...result, totalCleaned },
      durationMs: Date.now() - startTime,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        ...result,
        totalCleaned,
        trace_id: traceId,
        duration: Date.now() - startTime,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Cleanup exception', { error: errorMessage });

    return new Response(
      JSON.stringify({
        ok: false,
        success: false,
        error: errorMessage,
        trace_id: traceId,
        duration: Date.now() - startTime,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
