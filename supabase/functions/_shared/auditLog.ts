/**
 * Audit Log Helper
 * Generates trace IDs and logs events to system_audit_log
 * Uses compact payloads - no full cart snapshots
 */

// Use 'any' type for SupabaseClient to avoid version mismatches between edge functions
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientAny = any;
/**
 * Generates a unique trace ID for request tracking
 * Format: traceId-timestamp-random
 */
export function generateTraceId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `trace-${timestamp}-${random}`;
}

/**
 * Event types for audit logging
 */
export type AuditEventType = 
  | 'CHECKOUT_STARTED'
  | 'CHECKOUT_IDEMPOTENT_HIT'
  | 'CHECKOUT_COMPLETED'
  | 'CHECKOUT_FAILED'
  | 'PAYMENT_CALLBACK_RECEIVED'
  | 'PAYMENT_VERIFIED'
  | 'ORDER_FINALIZED_PAID'
  | 'RECONCILE_STARTED'
  | 'RECONCILE_ORDER_FIXED'
  | 'RECONCILE_COMPLETED'
  | 'CLEANUP_COMPLETED'
  | 'RATE_LIMIT_EXCEEDED';

/**
 * Compact audit payload - never include full cart or large data
 */
export interface AuditPayload {
  // Order summary
  order_id?: string;
  item_count?: number;
  total_usd?: number;
  currency?: string;
  
  // Payment info (compact)
  payment_method?: string;
  payment_ref?: string;
  operator_ref?: string;
  
  // Idempotency
  cart_hash?: string;
  idempotent?: boolean;
  reused_session_id?: string;
  
  // Rate limit
  rate_limit_key?: string;
  rate_limit_count?: number;
  
  // Reconciliation
  orders_checked?: number;
  orders_fixed?: number;
  
  // Generic
  reason?: string;
  [key: string]: unknown;
}

/**
 * Log an event to system_audit_log
 * Uses service role client to bypass RLS
 */
export async function logAuditEvent(
  supabase: SupabaseClientAny,
  traceId: string,
  eventType: AuditEventType,
  options: {
    userId?: string;
    orderId?: string;
    paymentAttemptId?: string;
    payload?: AuditPayload;
    errorMessage?: string;
    durationMs?: number;
  } = {}
): Promise<void> {
  try {
    // Ensure payload is compact (max 50 keys, no nested objects deeper than 2 levels)
    const compactPayload = options.payload 
      ? compactifyPayload(options.payload) 
      : {};
    
    const { error } = await supabase
      .from('system_audit_log')
      .insert({
        trace_id: traceId,
        event_type: eventType,
        user_id: options.userId || null,
        order_id: options.orderId || null,
        payment_attempt_id: options.paymentAttemptId || null,
        payload: compactPayload,
        error_message: options.errorMessage?.substring(0, 500) || null, // Truncate errors
        duration_ms: options.durationMs || null,
      });
    
    if (error) {
      console.error('[AuditLog] Failed to insert audit log:', error.message);
    }
  } catch (err) {
    // Never fail the main request due to audit logging
    console.error('[AuditLog] Exception during audit logging:', err);
  }
}

/**
 * Ensures payload is compact - no large nested objects
 */
function compactifyPayload(payload: AuditPayload): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let keyCount = 0;
  const maxKeys = 30;
  
  for (const [key, value] of Object.entries(payload)) {
    if (keyCount >= maxKeys) break;
    
    // Skip null/undefined
    if (value === null || value === undefined) continue;
    
    // Stringify arrays/objects if they're too large
    if (Array.isArray(value)) {
      if (value.length > 10) {
        result[key] = `[Array of ${value.length} items]`;
      } else {
        result[key] = value;
      }
    } else if (typeof value === 'object') {
      // Flatten or summarize objects
      const objKeys = Object.keys(value as object);
      if (objKeys.length > 10) {
        result[key] = `{Object with ${objKeys.length} keys}`;
      } else {
        result[key] = value;
      }
    } else if (typeof value === 'string' && value.length > 200) {
      // Truncate long strings
      result[key] = value.substring(0, 200) + '...';
    } else {
      result[key] = value;
    }
    
    keyCount++;
  }
  
  return result;
}

/**
 * Create a scoped logger with trace ID prefix
 */
export function createTracedLogger(traceId: string) {
  return {
    log: (message: string, data?: Record<string, unknown>) => {
      console.log(`[${traceId}] ${message}`, data ? JSON.stringify(data) : '');
    },
    warn: (message: string, data?: Record<string, unknown>) => {
      console.warn(`[${traceId}] ${message}`, data ? JSON.stringify(data) : '');
    },
    error: (message: string, data?: Record<string, unknown>) => {
      console.error(`[${traceId}] ${message}`, data ? JSON.stringify(data) : '');
    },
  };
}

/**
 * Simplified logAudit wrapper for easy usage
 * Usage: await logAudit(supabase, { traceId, eventType, userId?, orderId?, payload? })
 */
export async function logAudit(
  supabase: SupabaseClientAny,
  params: {
    traceId: string;
    eventType: string;
    userId?: string;
    orderId?: string;
    paymentAttemptId?: string;
    payload?: Record<string, unknown>;
    errorMessage?: string;
    durationMs?: number;
  }
): Promise<void> {
  try {
    const compactPayload = params.payload 
      ? compactifyPayload(params.payload as AuditPayload) 
      : {};
    
    const { error } = await supabase
      .from('system_audit_log')
      .insert({
        trace_id: params.traceId,
        event_type: params.eventType,
        user_id: params.userId || null,
        order_id: params.orderId || null,
        payment_attempt_id: params.paymentAttemptId || null,
        payload: compactPayload,
        error_message: params.errorMessage?.substring(0, 500) || null,
        duration_ms: params.durationMs || null,
      });
    
    if (error) {
      console.error('[AuditLog] Failed to insert:', error.message);
    }
  } catch (err) {
    console.error('[AuditLog] Exception:', err);
  }
}

/**
 * Log admin actions to admin_audit_logs table
 * Used by admin-home-sections, admin-home-seeds, etc.
 */
export async function logAdminAction(
  supabase: SupabaseClientAny,
  params: {
    adminId: string;
    actionType: string;
    targetSection: string;
    targetId: string | null;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const { error } = await supabase
      .from('admin_audit_logs')
      .insert({
        admin_id: params.adminId,
        action_type: params.actionType,
        target_section: params.targetSection,
        target_id: params.targetId,
        details: params.details || {},
      });

    if (error) {
      console.error('[AuditLog] Admin action log failed:', error.message);
    }
  } catch (err) {
    console.error('[AuditLog] Admin action log exception:', err);
  }
}
