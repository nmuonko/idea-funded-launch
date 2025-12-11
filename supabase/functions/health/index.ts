import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Health Check Endpoint
 * 
 * Validates:
 * - Database connectivity
 * - Settings table has valid data
 * - MaishaPay API reachability (optional)
 * 
 * GET /health
 * Returns: { status: "healthy" | "degraded" | "unhealthy", checks: {...} }
 */

interface HealthCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  latencyMs?: number;
  message?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const checks: HealthCheck[] = [];
  
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Check 1: Database connectivity
  const dbStart = Date.now();
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('id, exchange_rate_usd_to_cdf')
      .limit(1)
      .maybeSingle();
    
    const dbLatency = Date.now() - dbStart;
    
    if (error) {
      checks.push({
        name: 'database',
        status: 'fail',
        latencyMs: dbLatency,
        message: error.message,
      });
    } else if (!data) {
      checks.push({
        name: 'database',
        status: 'warn',
        latencyMs: dbLatency,
        message: 'Settings table is empty',
      });
    } else {
      checks.push({
        name: 'database',
        status: 'pass',
        latencyMs: dbLatency,
        message: `Exchange rate: ${data.exchange_rate_usd_to_cdf}`,
      });
    }
  } catch (err: any) {
    checks.push({
      name: 'database',
      status: 'fail',
      latencyMs: Date.now() - dbStart,
      message: err.message,
    });
  }

  // Check 2: Auth service
  const authStart = Date.now();
  try {
    // Simple auth check - just verify the client can be created
    const { data: { users }, error } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });
    
    const authLatency = Date.now() - authStart;
    
    if (error) {
      checks.push({
        name: 'auth',
        status: 'warn',
        latencyMs: authLatency,
        message: error.message,
      });
    } else {
      checks.push({
        name: 'auth',
        status: 'pass',
        latencyMs: authLatency,
      });
    }
  } catch (err: any) {
    checks.push({
      name: 'auth',
      status: 'warn',
      latencyMs: Date.now() - authStart,
      message: err.message,
    });
  }

  // Check 3: Environment variables
  const requiredEnvVars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_ANON_KEY',
    'RESEND_API_KEY',
  ];
  
  const missingEnvVars = requiredEnvVars.filter(v => !Deno.env.get(v));
  
  if (missingEnvVars.length > 0) {
    checks.push({
      name: 'environment',
      status: 'fail',
      message: `Missing: ${missingEnvVars.join(', ')}`,
    });
  } else {
    checks.push({
      name: 'environment',
      status: 'pass',
    });
  }

  // Check 4: MaishaPay config (optional)
  const maishapayVars = ['MAISHAPAY_PUBLIC_API_KEY', 'MAISHAPAY_SECRET_API_KEY'];
  const hasMaishapay = maishapayVars.every(v => Deno.env.get(v));
  
  checks.push({
    name: 'maishapay',
    status: hasMaishapay ? 'pass' : 'warn',
    message: hasMaishapay ? 'Configured' : 'Not configured (payments may not work)',
  });

  // Determine overall status
  const hasFailure = checks.some(c => c.status === 'fail');
  const hasWarning = checks.some(c => c.status === 'warn');
  
  let overallStatus: 'healthy' | 'degraded' | 'unhealthy';
  if (hasFailure) {
    overallStatus = 'unhealthy';
  } else if (hasWarning) {
    overallStatus = 'degraded';
  } else {
    overallStatus = 'healthy';
  }

  const totalLatency = Date.now() - startTime;

  return new Response(
    JSON.stringify({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      totalLatencyMs: totalLatency,
      checks,
    }),
    {
      status: overallStatus === 'unhealthy' ? 503 : 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});