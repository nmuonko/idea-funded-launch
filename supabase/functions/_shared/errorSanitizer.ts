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
