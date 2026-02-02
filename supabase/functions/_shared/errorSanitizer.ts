/**
 * Error sanitization utility for Edge Functions
 * Maps internal errors to safe client-facing messages
 */

export interface SanitizedError {
  code: string;
  message: string;
}

/**
 * Sanitizes error messages to prevent leaking internal details to clients.
 * Logs full error server-side while returning safe messages to clients.
 */
export function sanitizeError(error: any, functionName: string): SanitizedError {
  // Always log full error server-side for debugging
  console.error(`[${functionName}] Internal error:`, {
    message: error?.message,
    code: error?.code,
    hint: error?.hint,
    details: error?.details,
  });

  // Database errors (PostgreSQL error codes)
  if (error?.code === '42501') {
    return { code: 'ACCESS_DENIED', message: 'Access denied' };
  }
  if (error?.code === '23505') {
    return { code: 'DUPLICATE_ENTRY', message: 'This record already exists' };
  }
  if (error?.code === '23503') {
    return { code: 'REFERENCE_ERROR', message: 'Referenced record not found' };
  }
  if (error?.code === '42P01') {
    return { code: 'SERVER_ERROR', message: 'An error occurred' };
  }
  if (error?.code?.startsWith('22')) {
    return { code: 'INVALID_DATA', message: 'Invalid data format' };
  }
  if (error?.code?.startsWith('23')) {
    return { code: 'CONSTRAINT_ERROR', message: 'Operation not allowed' };
  }

  // Authentication errors
  const msg = (error?.message || '').toLowerCase();
  if (msg.includes('jwt') || msg.includes('token')) {
    return { code: 'AUTH_ERROR', message: 'Authentication failed' };
  }
  if (msg.includes('unauthorized') || msg.includes('not authenticated')) {
    return { code: 'UNAUTHORIZED', message: 'Unauthorized' };
  }
  if (msg.includes('forbidden') || msg.includes('permission')) {
    return { code: 'FORBIDDEN', message: 'Access denied' };
  }

  // Network/External service errors
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return { code: 'TIMEOUT', message: 'Request timed out. Please try again.' };
  }
  if (msg.includes('network') || msg.includes('fetch')) {
    return { code: 'NETWORK_ERROR', message: 'Network error. Please try again.' };
  }

  // Specific known errors that are safe to pass through
  if (error?.message === 'Order not found') {
    return { code: 'NOT_FOUND', message: 'Order not found' };
  }
  if (error?.message === 'Customer not found') {
    return { code: 'NOT_FOUND', message: 'Customer not found' };
  }

  // Default: generic error (never expose raw error.message)
  return { code: 'SERVER_ERROR', message: 'An error occurred. Please try again.' };
}

/**
 * Creates a JSON error response with sanitized error message
 */
export function createErrorResponse(
  error: any, 
  functionName: string, 
  corsHeaders: Record<string, string>,
  statusCode: number = 500
): Response {
  const sanitized = sanitizeError(error, functionName);
  return new Response(
    JSON.stringify({ error: sanitized.message, code: sanitized.code }),
    { status: statusCode, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

/**
 * Sanitizes payment error messages for storage in payment_attempts.last_error
 * Removes sensitive debugging info (stack traces, internal API keys, paths, etc.)
 * while preserving actionable error categories for debugging.
 * 
 * IMPORTANT: This is used to sanitize errors BEFORE storing them in the database
 * to prevent exposing sensitive payment flow debugging information.
 */
export function sanitizePaymentError(rawError: string | null | undefined): string {
  if (!rawError) {
    return 'Payment processing error';
  }

  const errorLower = rawError.toLowerCase();

  // Strip potentially sensitive patterns first
  let sanitized = rawError
    // Remove file paths
    .replace(/\/[^\s]+\.(ts|js|json)/gi, '[path]')
    // Remove stack traces
    .replace(/at\s+\S+\s+\([^)]+\)/g, '')
    .replace(/\s+at\s+\S+/g, '')
    // Remove API keys/tokens that might leak
    .replace(/sk_[a-zA-Z0-9_]+/gi, '[key]')
    .replace(/pk_[a-zA-Z0-9_]+/gi, '[key]')
    .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [token]')
    .replace(/[a-f0-9]{32,}/gi, '[hash]')
    // Remove internal error codes that reveal implementation
    .replace(/PGRST\d+/g, 'DB_ERROR')
    .replace(/PostgrestError/gi, 'Database error')
    // Remove IP addresses
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[ip]')
    // Remove URLs that might contain tokens
    .replace(/https?:\/\/[^\s]+/gi, '[url]')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();

  // Map to safe categories based on error content
  // pawaPay specific errors
  if (errorLower.includes('insufficient') || errorLower.includes('balance')) {
    return 'INSUFFICIENT_FUNDS: Mobile money account has insufficient balance';
  }
  if (errorLower.includes('invalid phone') || errorLower.includes('phone number')) {
    return 'INVALID_PHONE: The phone number format is invalid';
  }
  if (errorLower.includes('rejected') || errorLower.includes('declined')) {
    return 'PAYMENT_DECLINED: Payment was declined by the provider';
  }
  if (errorLower.includes('timeout') || errorLower.includes('timed out')) {
    return 'TIMEOUT: Payment request timed out';
  }
  if (errorLower.includes('not supported') || errorLower.includes('unsupported')) {
    return 'UNSUPPORTED: Payment method not supported in this region';
  }
  if (errorLower.includes('limit exceeded') || errorLower.includes('daily limit')) {
    return 'LIMIT_EXCEEDED: Transaction limit exceeded';
  }
  if (errorLower.includes('duplicate') || errorLower.includes('already processed')) {
    return 'DUPLICATE: This payment has already been processed';
  }

  // Stripe specific errors
  if (errorLower.includes('card_declined') || errorLower.includes('card declined')) {
    return 'CARD_DECLINED: Your card was declined';
  }
  if (errorLower.includes('expired_card') || errorLower.includes('card expired')) {
    return 'CARD_EXPIRED: Your card has expired';
  }
  if (errorLower.includes('incorrect_cvc') || errorLower.includes('cvc')) {
    return 'INVALID_CVC: Card security code is incorrect';
  }
  if (errorLower.includes('processing_error')) {
    return 'PROCESSING_ERROR: Payment processing error occurred';
  }
  if (errorLower.includes('rate_limit')) {
    return 'RATE_LIMITED: Too many payment attempts, please wait';
  }
  if (errorLower.includes('authentication_required') || errorLower.includes('3d secure')) {
    return 'AUTH_REQUIRED: Additional authentication required';
  }

  // Network/connectivity errors
  if (errorLower.includes('network') || errorLower.includes('connection')) {
    return 'NETWORK_ERROR: Network connection issue';
  }
  if (errorLower.includes('unavailable') || errorLower.includes('service')) {
    return 'SERVICE_UNAVAILABLE: Payment service temporarily unavailable';
  }

  // If the sanitized string is too long, truncate it
  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 97) + '...';
  }

  // If we couldn't categorize it, return a generic but sanitized version
  // Only keep alphanumeric, spaces, and basic punctuation
  const safeSanitized = sanitized.replace(/[^a-zA-Z0-9\s.,!?:-]/g, '');
  
  if (safeSanitized.length < 10) {
    return 'PAYMENT_ERROR: Payment processing failed';
  }

  return `PAYMENT_ERROR: ${safeSanitized}`;
}
