// Shared HTTP response utilities for Edge Functions
// Standardized JSON responses and error handling

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Standard error codes
export const ErrorCodes = {
  INVALID_URL: 'INVALID_URL',
  UNSUPPORTED_DOMAIN: 'UNSUPPORTED_DOMAIN',
  RATE_LIMIT: 'RATE_LIMIT',
  SCRAPE_FAILED: 'SCRAPE_FAILED',
  PRICE_NOT_FOUND: 'PRICE_NOT_FOUND',
  TIMEOUT: 'TIMEOUT',
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  BAD_REQUEST: 'BAD_REQUEST',
} as const;

// ============== STORE API RESPONSE TYPES ==============
// Standardized response format for all store-related endpoints

export interface StoreApiError {
  ok: false;
  storeId: string;
  code: string;
  message: string;
}

export interface StoreApiSuccess<T = any> {
  ok: true;
  storeId: string;
  data?: T;
  [key: string]: any; // Allow additional fields at root level
}

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

// Error messages (user-friendly)
export const ErrorMessages: Record<string, string> = {
  INVALID_URL: 'Please provide a valid product URL.',
  UNSUPPORTED_DOMAIN: 'This store is not yet supported. Please choose a supported store from the AfriShop app.',
  RATE_LIMIT: 'Too many price lookups. Please wait a moment and try again.',
  SCRAPE_FAILED: "We couldn't reach this product page. Please try again.",
  PRICE_NOT_FOUND: "We couldn't detect a main price for this product. Please double-check the page and try again.",
  TIMEOUT: 'Request timed out. Please try again.',
  INTERNAL_ERROR: 'An unexpected error occurred. Please try again.',
  UNAUTHORIZED: 'Authorization required.',
  FORBIDDEN: 'Access denied.',
  NOT_FOUND: 'Resource not found.',
  BAD_REQUEST: 'Invalid request.',
};

/**
 * Create a successful JSON response
 */
export function jsonSuccess<T>(data: T, status = 200): Response {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Create an error JSON response with standardized format
 */
export function jsonError(
  status: number,
  code: string,
  message?: string
): Response {
  return new Response(
    JSON.stringify({
      error: code,
      message: message ?? ErrorMessages[code] ?? 'An error occurred.',
    }),
    {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Handle CORS preflight request
 */
export function handleCors(): Response {
  return new Response(null, { headers: corsHeaders });
}

/**
 * Get CORS headers for manual use
 */
export function getCorsHeaders(): Record<string, string> {
  return { ...corsHeaders };
}

/**
 * Create a standardized store API success response
 */
export function storeSuccess<T>(storeId: string, data: T, extraFields?: Record<string, any>): Response {
  const body: StoreApiSuccess<T> = {
    ok: true,
    storeId,
    ...data as any, // Spread data at root level for backward compatibility
    ...(extraFields || {}),
  };
  return new Response(
    JSON.stringify(body),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

/**
 * Create a standardized store API error response
 */
export function storeError(
  storeId: string,
  code: string,
  message?: string,
  status = 400,
  extraFields?: Record<string, any>
): Response {
  const body: StoreApiError = {
    ok: false,
    storeId,
    code,
    message: message ?? ErrorMessages[code] ?? 'An error occurred.',
    ...(extraFields || {}),
  };
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

/**
 * Check rate limit for a given key (e.g., IP address)
 * @returns true if allowed, false if rate limited
 */
export function checkRateLimit(
  key: string,
  maxRequests = 30,
  windowMs = 60000
): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(key);
  
  // Clean up old entries periodically
  if (rateLimitMap.size > 10000) {
    for (const [k, v] of rateLimitMap) {
      if (now > v.resetAt) rateLimitMap.delete(k);
    }
  }
  
  if (!record || now > record.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  
  if (record.count >= maxRequests) {
    return false;
  }
  
  record.count++;
  return true;
}

/**
 * Get client IP from request headers
 */
export function getClientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    req.headers.get('cf-connecting-ip') ??
    'unknown'
  );
}
