import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyCronAuth, cronAuthErrorResponse } from "../_shared/cronAuth.ts";
import { generateTraceId, logAuditEvent, createTracedLogger } from "../_shared/auditLog.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

/**
 * cleanup-expired-data Edge Function
 * Scheduled job to clean up expired records
 * 
 * REQUIRES: x-cron-secret header matching CRON_SECRET env var
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const traceId = generateTraceId();
  const log = createTracedLogger(traceId);

  log.log('cleanup-expired-data started');

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

    log.log('Calling cleanup_expired_records RPC');

    // Call the cleanup RPC function
    const { data, error } = await supabase.rpc('cleanup_expired_records');

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
      rate_limits_deleted: number;
      payment_attempts_expired: number;
      price_cache_deleted: number;
      product_cache_deleted: number;
      cleanup_at: string;
    };

    log.log('Cleanup completed', result);

    // Log to audit
    await logAuditEvent(supabase, traceId, 'CLEANUP_COMPLETED', {
      payload: {
        rate_limits_deleted: result.rate_limits_deleted,
        payment_attempts_expired: result.payment_attempts_expired,
        price_cache_deleted: result.price_cache_deleted,
        product_cache_deleted: result.product_cache_deleted,
      },
      durationMs: Date.now() - startTime,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        ...result,
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
