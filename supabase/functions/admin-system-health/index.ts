import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { verifyAndGetUser, errorResponse, handleCors, createAdminClient } from "../_shared/auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CircuitState {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  isAvailable: boolean;
  lastFailure?: string;
}

interface SystemHealthResponse {
  ok: boolean;
  timestamp: string;
  circuits: Record<string, CircuitState>;
  load: {
    currentLoad: number;
    maxLoad: number;
    loadLevel: number;
    mode: 'normal' | 'high' | 'critical';
    features: {
      aiRecommendations: boolean;
      liveSearch: boolean;
      realtimeSync: boolean;
    };
  };
  cache: {
    catalogCacheCount: number;
    productCacheCount: number;
    facetsCacheCount: number;
    rateLimitsCount: number;
  };
  database: {
    tableStats: Array<{
      table: string;
      rowEstimate: number;
      seqScans: number;
      idxScans: number;
      indexUsagePct: number;
    }>;
    lastAnalyze?: string;
  };
  cron: {
    scheduledJobs: Array<{
      name: string;
      schedule: string;
      lastRun?: string;
    }>;
  };
  providers: {
    ebay: { configured: boolean; tokenValid: boolean };
    amazon: { configured: boolean; budgetRemaining: number };
    stripe: { configured: boolean; mode: 'test' | 'live' };
    pawapay: { configured: boolean };
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify admin auth
    const { user } = await verifyAndGetUser(req);

    const adminClient = createAdminClient();
    const { data: roleData } = await adminClient
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (!roleData) {
      return errorResponse('Unauthorized: admin role required', 403);
    }

    const supabase = adminClient;

    // Gather all stats in parallel
    const [
      cacheStats,
      tableStats,
      cronJobs,
      providerBudget,
    ] = await Promise.all([
      // Cache table counts
      Promise.all([
        supabase.from('catalog_cache').select('*', { count: 'exact', head: true }),
        supabase.from('product_cache').select('*', { count: 'exact', head: true }),
        supabase.from('catalog_facets_cache').select('*', { count: 'exact', head: true }),
        supabase.from('rate_limits').select('*', { count: 'exact', head: true }),
      ]),
      // Table stats from pg_stat_user_tables
      supabase.rpc('get_table_statistics'),
      // Cron jobs (may not exist if pg_cron not enabled)
      supabase.from('cron.job').select('jobname, schedule, active').catch(() => ({ data: null })),
      // Provider budget
      supabase.from('provider_budget')
        .select('*')
        .eq('provider', 'amazon')
        .order('window_start', { ascending: false })
        .limit(1),
    ]);

    // Parse cache stats
    const [catalogCache, productCache, facetsCache, rateLimits] = cacheStats;

    // Check provider configurations
    const stripeKey = Deno.env.get('STRIPE_SECRET_KEY') || '';
    const pawapayKey = Deno.env.get('PAWAPAY_API_TOKEN') || '';
    const ebayToken = Deno.env.get('EBAY_OAUTH_TOKEN') || '';
    const rainforestKey = Deno.env.get('RAINFOREST_API_KEY') || '';

    // Calculate Amazon budget remaining
    const amazonBudget = providerBudget.data?.[0];
    const amazonRemaining = amazonBudget 
      ? Math.max(0, (amazonBudget.limit_count || 100) - (amazonBudget.call_count || 0))
      : 100;

    // Determine load level (simulated - in production would use actual metrics)
    const currentLoad = Math.floor(Math.random() * 150); // Simulated
    const maxLoad = 1000;
    const loadLevel = currentLoad / maxLoad;
    const mode = loadLevel > 0.8 ? 'critical' : loadLevel > 0.5 ? 'high' : 'normal';

    // Circuit breaker states (simulated - actual state is per-instance)
    // In a real implementation, you'd store these in a shared cache
    const circuits: Record<string, CircuitState> = {
      pawapay: { state: 'CLOSED', failures: 0, isAvailable: !!pawapayKey },
      stripe: { state: 'CLOSED', failures: 0, isAvailable: !!stripeKey },
      resend: { state: 'CLOSED', failures: 0, isAvailable: !!Deno.env.get('RESEND_API_KEY') },
      openai: { state: 'CLOSED', failures: 0, isAvailable: !!Deno.env.get('OPENAI_API_KEY') },
      ebay: { state: 'CLOSED', failures: 0, isAvailable: !!ebayToken },
      rainforest: { state: 'CLOSED', failures: 0, isAvailable: !!rainforestKey },
    };

    const response: SystemHealthResponse = {
      ok: true,
      timestamp: new Date().toISOString(),
      circuits,
      load: {
        currentLoad,
        maxLoad,
        loadLevel,
        mode,
        features: {
          aiRecommendations: mode !== 'critical',
          liveSearch: mode !== 'critical',
          realtimeSync: mode === 'normal',
        },
      },
      cache: {
        catalogCacheCount: catalogCache.count || 0,
        productCacheCount: productCache.count || 0,
        facetsCacheCount: facetsCache.count || 0,
        rateLimitsCount: rateLimits.count || 0,
      },
      database: {
        tableStats: (tableStats.data || []).map((row: any) => ({
          table: row.table_name,
          rowEstimate: row.row_estimate,
          seqScans: row.seq_scans,
          idxScans: row.idx_scans,
          indexUsagePct: row.index_usage_pct || 0,
        })),
      },
      cron: {
        scheduledJobs: (cronJobs as any)?.data?.map((job: any) => ({
          name: job.jobname,
          schedule: job.schedule,
        })) || [],
      },
      providers: {
        ebay: { 
          configured: !!ebayToken,
          tokenValid: !!ebayToken,
        },
        amazon: { 
          configured: !!rainforestKey,
          budgetRemaining: amazonRemaining,
        },
        stripe: { 
          configured: !!stripeKey,
          mode: stripeKey.startsWith('sk_live') ? 'live' : 'test',
        },
        pawapay: { 
          configured: !!pawapayKey,
        },
      },
    };

    return new Response(
      JSON.stringify(response),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SYSTEM_HEALTH_ERROR]', errorMessage);
    
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
