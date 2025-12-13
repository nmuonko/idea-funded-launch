// Shared HTTP response utilities for Edge Functions
// Standardized JSON responses and error handling with bilingual support

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Standard error codes - mobile app uses these to decide behavior
export const ErrorCodes = {
  INVALID_URL: 'INVALID_URL',
  UNSUPPORTED_DOMAIN: 'UNSUPPORTED_DOMAIN',
  RATE_LIMIT: 'RATE_LIMIT',
  SCRAPE_FAILED: 'SCRAPE_FAILED',
  SCRAPE_BLOCKED: 'SCRAPE_BLOCKED',       // Store actively blocking scraping
  PRICE_NOT_FOUND: 'PRICE_NOT_FOUND',
  TIMEOUT: 'TIMEOUT',
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  BAD_REQUEST: 'BAD_REQUEST',
  // Codes for mobile to decide "fallback to WebView"
  BOT_BLOCKED: 'BOT_BLOCKED',
  DYNAMIC_CONTENT: 'DYNAMIC_CONTENT',
  WEBVIEW_REQUIRED: 'WEBVIEW_REQUIRED',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
  TEMPORARY_ERROR: 'TEMPORARY_ERROR',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

// ============== BILINGUAL ERROR MESSAGES ==============
// Mobile app receives both message_en and message_fr

export interface BilingualError {
  message_en: string;
  message_fr: string;
}

export const ErrorMessagesBilingual: Record<string, BilingualError> = {
  INVALID_URL: {
    message_en: 'Please provide a valid product URL.',
    message_fr: 'Veuillez fournir une URL de produit valide.',
  },
  UNSUPPORTED_DOMAIN: {
    message_en: 'This store is not yet supported.',
    message_fr: 'Ce magasin n\'est pas encore pris en charge.',
  },
  RATE_LIMIT: {
    message_en: 'Too many requests. Please wait a moment.',
    message_fr: 'Trop de requêtes. Veuillez patienter.',
  },
  SCRAPE_FAILED: {
    message_en: 'Could not reach product page. Please try again.',
    message_fr: 'Impossible d\'accéder à la page. Veuillez réessayer.',
  },
  SCRAPE_BLOCKED: {
    message_en: 'This store blocked our request. Please open the page manually.',
    message_fr: 'Ce magasin a bloqué notre requête. Veuillez ouvrir la page manuellement.',
  },
  PRICE_NOT_FOUND: {
    message_en: 'Price not available. Try opening the page manually.',
    message_fr: 'Prix indisponible. Essayez d\'ouvrir la page manuellement.',
  },
  TIMEOUT: {
    message_en: 'Request timed out. Please try again.',
    message_fr: 'La requête a expiré. Veuillez réessayer.',
  },
  UPSTREAM_TIMEOUT: {
    message_en: 'Store did not respond in time.',
    message_fr: 'Le magasin n\'a pas répondu à temps.',
  },
  INTERNAL_ERROR: {
    message_en: 'An unexpected error occurred.',
    message_fr: 'Une erreur inattendue s\'est produite.',
  },
  UNAUTHORIZED: {
    message_en: 'Authorization required.',
    message_fr: 'Autorisation requise.',
  },
  FORBIDDEN: {
    message_en: 'Access denied.',
    message_fr: 'Accès refusé.',
  },
  NOT_FOUND: {
    message_en: 'Resource not found.',
    message_fr: 'Ressource introuvable.',
  },
  BAD_REQUEST: {
    message_en: 'Invalid request.',
    message_fr: 'Requête invalide.',
  },
  BOT_BLOCKED: {
    message_en: 'Store is blocking automated access. Open page manually.',
    message_fr: 'Le magasin bloque l\'accès automatisé. Ouvrez la page manuellement.',
  },
  DYNAMIC_CONTENT: {
    message_en: 'This page requires manual viewing.',
    message_fr: 'Cette page nécessite une consultation manuelle.',
  },
  WEBVIEW_REQUIRED: {
    message_en: 'Please open this product page manually.',
    message_fr: 'Veuillez ouvrir cette page de produit manuellement.',
  },
  CONNECTION_ERROR: {
    message_en: 'Connection error. Check your internet.',
    message_fr: 'Erreur de connexion. Vérifiez votre connexion.',
  },
  TEMPORARY_ERROR: {
    message_en: 'Temporary error. Please try again.',
    message_fr: 'Erreur temporaire. Veuillez réessayer.',
  },
};

// Legacy single-language messages (backward compatibility)
export const ErrorMessages: Record<string, string> = Object.fromEntries(
  Object.entries(ErrorMessagesBilingual).map(([k, v]) => [k, v.message_en])
);

// Retryable error codes - mobile can retry these
export const RETRYABLE_ERRORS = new Set([
  'TIMEOUT',
  'UPSTREAM_TIMEOUT',
  'TEMPORARY_ERROR',
  'CONNECTION_ERROR',
]);

// WebView fallback error codes - mobile should open WebView
export const WEBVIEW_FALLBACK_ERRORS = new Set([
  'BOT_BLOCKED',
  'DYNAMIC_CONTENT',
  'WEBVIEW_REQUIRED',
  'SCRAPE_BLOCKED',
  'PRICE_NOT_FOUND',
]);

// ============== STORE API RESPONSE TYPES ==============
// Standardized response format for all store-related endpoints

export interface StoreApiError {
  ok: false;
  storeId: string;
  code: string;
  message: string;
  [key: string]: any;
}

export interface StoreApiSuccess<T = any> {
  ok: true;
  storeId: string;
  data?: T;
  [key: string]: any;
}

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
 * Create an error JSON response with standardized bilingual format
 * Response includes: ok, code, message_en, message_fr, retryable, webviewFallback
 */
export function jsonError(
  status: number,
  code: string,
  customMessage?: string
): Response {
  const isRetryable = RETRYABLE_ERRORS.has(code);
  const useWebviewFallback = WEBVIEW_FALLBACK_ERRORS.has(code);
  const bilingual = ErrorMessagesBilingual[code] || { 
    message_en: customMessage || 'An error occurred.', 
    message_fr: customMessage || 'Une erreur s\'est produite.' 
  };
  
  return new Response(
    JSON.stringify({
      ok: false,
      code,
      error: code, // backward compatibility
      message: customMessage || bilingual.message_en, // backward compatibility
      message_en: customMessage || bilingual.message_en,
      message_fr: bilingual.message_fr,
      retryable: isRetryable,
      webviewFallback: useWebviewFallback,
      suggestedFallback: useWebviewFallback ? 'WEBVIEW' : null,
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
