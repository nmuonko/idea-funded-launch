/**
 * Supabase Health Check Utilities
 * Used to diagnose connectivity issues in production
 */

export interface HealthCheckResult {
  success: boolean;
  status?: number;
  statusText?: string;
  error?: string;
  errorType: 'none' | 'csp_blocked' | 'env_missing' | 'network_error' | 'auth_error' | 'unknown';
  latencyMs?: number;
  details?: string;
}

export interface DiagnosticSummary {
  envValid: boolean;
  canReachSupabase: boolean;
  errorType: HealthCheckResult['errorType'];
  recommendation: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const getSupabaseConfig = () => ({
  url: SUPABASE_URL || '',
  hasUrl: !!SUPABASE_URL,
  hasKey: !!SUPABASE_KEY,
  keyLength: SUPABASE_KEY?.length || 0,
  hostname: typeof window !== 'undefined' ? window.location.hostname : 'unknown',
  isProduction: typeof window !== 'undefined' && !window.location.hostname.includes('lovable') && !window.location.hostname.includes('localhost'),
});

export const validateEnvVariables = (): { valid: boolean; errors: string[] } => {
  const errors: string[] = [];
  
  if (!SUPABASE_URL) {
    errors.push('VITE_SUPABASE_URL is missing');
  } else if (!SUPABASE_URL.includes('supabase')) {
    errors.push('VITE_SUPABASE_URL does not appear to be a valid Supabase URL');
  }
  
  if (!SUPABASE_KEY) {
    errors.push('VITE_SUPABASE_PUBLISHABLE_KEY is missing');
  } else if (SUPABASE_KEY.length < 100) {
    errors.push('VITE_SUPABASE_PUBLISHABLE_KEY appears too short');
  }
  
  return { valid: errors.length === 0, errors };
};

const classifyError = (error: any): HealthCheckResult['errorType'] => {
  const message = error?.message || String(error);
  const errorName = error?.name || '';
  
  // CSP blocking
  if (message.includes('Refused to connect') || message.includes('Content Security Policy')) {
    return 'csp_blocked';
  }
  
  // CORS errors often manifest as TypeError with "Failed to fetch"
  if (message === 'Failed to fetch' || errorName === 'TypeError') {
    return 'network_error';
  }
  
  // Network errors
  if (message.includes('NetworkError') || message.includes('net::ERR')) {
    return 'network_error';
  }
  
  return 'unknown';
};

export const getRecommendation = (errorType: HealthCheckResult['errorType']): string => {
  switch (errorType) {
    case 'env_missing':
      return 'Environment variables are not configured. The app may not have been deployed correctly. Contact support.';
    case 'csp_blocked':
      return 'Content Security Policy is blocking Supabase connections. This is a hosting configuration issue. Contact support.';
    case 'network_error':
      return 'Unable to reach the server. This is often caused by: 1) Ad blocker or privacy extension blocking "supabase.co", 2) Corporate firewall, 3) VPN interference. Try disabling ad blockers or using incognito mode.';
    case 'auth_error':
      return 'Authentication configuration error. The API key may be invalid. Contact support.';
    default:
      return 'An unexpected error occurred. Please try again or contact support.';
  }
};

/**
 * Check if the browser might be blocking requests (ad blocker detection)
 */
export const checkForBlockers = async (): Promise<{ blocked: boolean; reason: string }> => {
  try {
    // Try a simple fetch to a known working endpoint
    const testController = new AbortController();
    const timeoutId = setTimeout(() => testController.abort(), 5000);
    
    const response = await fetch('https://www.google.com/favicon.ico', {
      method: 'HEAD',
      mode: 'no-cors',
      signal: testController.signal,
    });
    
    clearTimeout(timeoutId);
    
    // If we can reach Google but not Supabase, likely an ad blocker
    return { blocked: false, reason: 'External requests work - Supabase might be specifically blocked' };
  } catch {
    return { blocked: true, reason: 'All external requests blocked - check network/firewall' };
  }
};

export const testSupabaseHealth = async (): Promise<HealthCheckResult> => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return {
      success: false,
      error: 'Supabase environment variables are missing',
      errorType: 'env_missing',
    };
  }

  const startTime = Date.now();
  
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      method: 'GET',
      mode: 'cors',
      headers: {
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json',
      },
    });
    
    const latencyMs = Date.now() - startTime;
    
    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        status: response.status,
        statusText: response.statusText,
        error: `Auth error: ${response.status} ${response.statusText}`,
        errorType: 'auth_error',
        latencyMs,
      };
    }
    
    return {
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      errorType: 'none',
      latencyMs,
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const errorType = classifyError(error);
    
    // Add more details for network errors
    let details = '';
    if (errorType === 'network_error') {
      details = `This could be a CORS preflight failure, DNS issue, or the server is unreachable. Error name: ${error.name}`;
    }
    
    return {
      success: false,
      error: error.message,
      errorType,
      latencyMs,
      details,
    };
  }
};

export const testSupabaseRest = async (): Promise<HealthCheckResult> => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return {
      success: false,
      error: 'Supabase environment variables are missing',
      errorType: 'env_missing',
    };
  }

  const startTime = Date.now();
  
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
      method: 'GET',
      mode: 'cors',
      headers: {
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json',
      },
    });
    
    const latencyMs = Date.now() - startTime;
    
    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        status: response.status,
        statusText: response.statusText,
        error: `Auth error: ${response.status} ${response.statusText}`,
        errorType: 'auth_error',
        latencyMs,
      };
    }
    
    return {
      success: response.ok,
      status: response.status,
      statusText: response.statusText,
      errorType: 'none',
      latencyMs,
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    const errorType = classifyError(error);
    
    let details = '';
    if (errorType === 'network_error') {
      details = `This could be a CORS preflight failure, DNS issue, or the server is unreachable. Error name: ${error.name}`;
    }
    
    return {
      success: false,
      error: error.message,
      errorType,
      latencyMs,
      details,
    };
  }
};

/**
 * Test using the actual Supabase client (not raw fetch)
 * This helps distinguish between fetch issues and client configuration issues
 */
export const testSupabaseClient = async (): Promise<HealthCheckResult> => {
  const startTime = Date.now();
  
  try {
    // Dynamic import to avoid circular dependency
    const { supabase } = await import('@/integrations/supabase/client');
    
    // Try to get the session - this uses the configured Supabase client
    const { data, error } = await supabase.auth.getSession();
    
    const latencyMs = Date.now() - startTime;
    
    if (error) {
      return {
        success: false,
        error: error.message,
        errorType: classifyError(error),
        latencyMs,
        details: `Supabase client error: ${error.name || 'Unknown'}`,
      };
    }
    
    return {
      success: true,
      status: 200,
      statusText: 'OK',
      errorType: 'none',
      latencyMs,
      details: data.session ? 'Session exists' : 'No active session (expected if not logged in)',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
      errorType: classifyError(error),
      latencyMs: Date.now() - startTime,
      details: `Client exception: ${error.name}`,
    };
  }
};

export const runStartupHealthCheck = async (): Promise<void> => {
  if (!import.meta.env.DEV) return;
  
  const config = getSupabaseConfig();
  console.log('[SUPABASE_HEALTH] Config:', config);
  
  const healthResult = await testSupabaseHealth();
  console.log('[SUPABASE_HEALTH] Auth health check:', healthResult);
  
  if (!healthResult.success) {
    console.error('[SUPABASE_HEALTH] ⚠️ Supabase connectivity issue detected:', {
      errorType: healthResult.errorType,
      error: healthResult.error,
    });
  } else {
    console.log('[SUPABASE_HEALTH] ✅ Supabase is reachable');
  }
};

/**
 * Run a quick diagnostic and return a summary with recommendation
 */
export const runQuickDiagnostic = async (): Promise<DiagnosticSummary> => {
  const envCheck = validateEnvVariables();
  
  if (!envCheck.valid) {
    return {
      envValid: false,
      canReachSupabase: false,
      errorType: 'env_missing',
      recommendation: getRecommendation('env_missing'),
    };
  }
  
  const healthResult = await testSupabaseHealth();
  
  return {
    envValid: true,
    canReachSupabase: healthResult.success,
    errorType: healthResult.errorType,
    recommendation: healthResult.success ? 'All systems operational.' : getRecommendation(healthResult.errorType),
  };
};
