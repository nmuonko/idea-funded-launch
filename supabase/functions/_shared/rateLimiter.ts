/**
 * Rate Limiter Helper
 * Checks rate limits using the check_rate_limit RPC function
 * Supports per-user and per-IP rate limiting
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  remaining: number;
  reset_at: string;
}

export interface DualRateLimitResult {
  allowed: boolean;
  user_result?: RateLimitResult;
  ip_result?: RateLimitResult;
  blocked_by?: 'user' | 'ip';
}

/**
 * Check a single rate limit key
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  key: string,
  limit: number,
  windowMinutes: number
): Promise<RateLimitResult> {
  const { data, error } = await supabase.rpc('check_rate_limit', {
    p_key: key,
    p_limit: limit,
    p_window_minutes: windowMinutes,
  });

  if (error) {
    console.error('[RateLimiter] Error checking rate limit:', error);
    // On error, allow the request to proceed (fail open)
    return {
      allowed: true,
      count: 0,
      limit,
      remaining: limit,
      reset_at: new Date(Date.now() + windowMinutes * 60000).toISOString(),
    };
  }

  return data as RateLimitResult;
}

/**
 * Check dual rate limits (per-user AND per-IP)
 * Both must pass for the request to be allowed
 */
export async function checkDualRateLimit(
  supabase: SupabaseClient,
  userId: string,
  clientIp: string,
  action: string,
  userLimit: number,
  ipLimit: number,
  windowMinutes: number
): Promise<DualRateLimitResult> {
  const userKey = `user:${userId}:${action}`;
  const ipKey = `ip:${clientIp}:${action}`;

  // Check both limits in parallel
  const [userResult, ipResult] = await Promise.all([
    checkRateLimit(supabase, userKey, userLimit, windowMinutes),
    checkRateLimit(supabase, ipKey, ipLimit, windowMinutes),
  ]);

  // Both must be allowed
  if (!userResult.allowed) {
    return {
      allowed: false,
      user_result: userResult,
      ip_result: ipResult,
      blocked_by: 'user',
    };
  }

  if (!ipResult.allowed) {
    return {
      allowed: false,
      user_result: userResult,
      ip_result: ipResult,
      blocked_by: 'ip',
    };
  }

  return {
    allowed: true,
    user_result: userResult,
    ip_result: ipResult,
  };
}

/**
 * Extract client IP from request headers
 * Checks common proxy headers
 */
export function getClientIp(req: Request): string {
  const headers = req.headers;
  
  // Check common proxy headers in order of preference
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    // Take the first IP in the chain (original client)
    return forwardedFor.split(',')[0].trim();
  }
  
  const realIp = headers.get('x-real-ip');
  if (realIp) {
    return realIp.trim();
  }
  
  const cfConnectingIp = headers.get('cf-connecting-ip');
  if (cfConnectingIp) {
    return cfConnectingIp.trim();
  }
  
  // Fallback
  return 'unknown';
}

/**
 * Create rate limit exceeded response
 */
export function rateLimitExceededResponse(
  result: DualRateLimitResult,
  action: string
): Response {
  const blockedResult = result.blocked_by === 'user' 
    ? result.user_result 
    : result.ip_result;
  
  return new Response(
    JSON.stringify({
      ok: false,
      success: false,
      code: 'RATE_LIMIT_EXCEEDED',
      error: `Too many ${action} requests. Please wait before trying again.`,
      retry_after: blockedResult?.reset_at,
      limit: blockedResult?.limit,
      remaining: 0,
    }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Retry-After': blockedResult?.reset_at || '60',
        'X-RateLimit-Limit': String(blockedResult?.limit || 0),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': blockedResult?.reset_at || '',
      },
    }
  );
}
