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
  
  if (message.includes('Refused to connect') || message.includes('Content Security Policy')) {
    return 'csp_blocked';
  }
  if (message === 'Failed to fetch' || error?.name === 'TypeError') {
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
      return 'Unable to reach the server. Check your internet connection or try again later.';
    case 'auth_error':
      return 'Authentication configuration error. The API key may be invalid. Contact support.';
    default:
      return 'An unexpected error occurred. Please try again or contact support.';
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
      headers: {
        'apikey': SUPABASE_KEY,
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
    return {
      success: false,
      error: error.message,
      errorType: classifyError(error),
      latencyMs: Date.now() - startTime,
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
      headers: {
        'apikey': SUPABASE_KEY,
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
    return {
      success: false,
      error: error.message,
      errorType: classifyError(error),
      latencyMs: Date.now() - startTime,
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
