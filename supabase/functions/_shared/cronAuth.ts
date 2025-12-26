/**
 * Cron Authentication Helper
 * Validates x-cron-secret header against CRON_SECRET environment variable
 */

export interface CronAuthResult {
  authorized: boolean;
  error?: string;
}

/**
 * Validates that the request has the correct cron secret header
 * Returns 401 if missing or incorrect
 */
export function verifyCronAuth(req: Request): CronAuthResult {
  const cronSecret = Deno.env.get('CRON_SECRET');
  
  // CRON_SECRET must be configured
  if (!cronSecret) {
    console.error('[CronAuth] CRITICAL: CRON_SECRET not configured');
    return {
      authorized: false,
      error: 'CRON_SECRET not configured',
    };
  }
  
  // Check x-cron-secret header
  const providedSecret = req.headers.get('x-cron-secret');
  
  if (!providedSecret) {
    console.warn('[CronAuth] Missing x-cron-secret header');
    return {
      authorized: false,
      error: 'Missing x-cron-secret header',
    };
  }
  
  // Constant-time comparison to prevent timing attacks
  if (providedSecret.length !== cronSecret.length) {
    console.warn('[CronAuth] Invalid x-cron-secret - length mismatch');
    return {
      authorized: false,
      error: 'Invalid x-cron-secret',
    };
  }
  
  let match = true;
  for (let i = 0; i < cronSecret.length; i++) {
    if (providedSecret.charCodeAt(i) !== cronSecret.charCodeAt(i)) {
      match = false;
    }
  }
  
  if (!match) {
    console.warn('[CronAuth] Invalid x-cron-secret - value mismatch');
    return {
      authorized: false,
      error: 'Invalid x-cron-secret',
    };
  }
  
  console.log('[CronAuth] Cron authentication successful');
  return { authorized: true };
}

/**
 * Creates an unauthorized response for failed cron auth
 */
export function cronAuthErrorResponse(error: string): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      success: false,
      code: 'UNAUTHORIZED',
      error,
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    }
  );
}
