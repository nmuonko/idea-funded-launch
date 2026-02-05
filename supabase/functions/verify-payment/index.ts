import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { normalizePaymentStatus as normalizeProviderStatus } from "../_shared/paymentProviders.ts";
import { generateTraceId, logAudit } from "../_shared/auditLog.ts";

// SDK-free: minimal REST client
function createClient(url: string, key: string, options?: { global?: { headers?: Record<string, string> } }) {
  const baseHeaders: Record<string, string> = { 
    apikey: key, 
    Authorization: `Bearer ${options?.global?.headers?.Authorization?.replace('Bearer ', '') || key}`,
    'Content-Type': 'application/json',
  };
  return {
    auth: {
      getUser: async () => {
        const res = await fetch(`${url}/auth/v1/user`, { headers: baseHeaders });
        if (!res.ok) return { data: { user: null }, error: { message: 'Unauthorized' } };
        return { data: { user: await res.json() }, error: null };
      }
    },
    from: (table: string) => ({
      select: (cols = "*") => ({
        _table: table, _cols: cols, _filters: [] as string[], _single: false,
        eq: function(col: string, val: unknown) { this._filters.push(`${col}=eq.${val}`); return this; },
        maybeSingle: function() { this._single = true; return this; },
        single: function() { this._single = true; return this; },
        then: async function(resolve: (v: unknown) => void) {
          const params = [`select=${this._cols}`, ...this._filters].join("&");
          const headers = this._single ? { ...baseHeaders, Accept: "application/vnd.pgrst.object+json" } : baseHeaders;
          try {
            const res = await fetch(`${url}/rest/v1/${this._table}?${params}`, { headers });
            if (!res.ok) return resolve({ data: null, error: { message: `${res.status}` } });
            return resolve({ data: await res.json(), error: null });
          } catch (e: unknown) { return resolve({ data: null, error: { message: String(e) } }); }
        }
      }),
      update: (data: unknown) => ({
        _table: table, _data: data, _filters: [] as string[],
        eq: function(col: string, val: unknown) { this._filters.push(`${col}=eq.${val}`); return this; },
        then: async function(resolve: (v: unknown) => void) {
          const params = this._filters.join("&");
          try {
            const res = await fetch(`${url}/rest/v1/${this._table}?${params}`, {
              method: 'PATCH', headers: baseHeaders, body: JSON.stringify(this._data)
            });
            if (!res.ok) return resolve({ error: { message: `${res.status}` } });
            return resolve({ error: null });
          } catch (e: unknown) { return resolve({ error: { message: String(e) } }); }
        }
      }),
    }),
    rpc: (fn: string, params?: Record<string, unknown>) => ({
      then: async (resolve: (v: unknown) => void) => {
        const res = await fetch(`${url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: baseHeaders, body: JSON.stringify(params || {}) });
        if (!res.ok) return resolve({ data: null, error: { message: `${res.status}` } });
        return resolve({ data: await res.json(), error: null });
      }
    }),
  };
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-signature',
};

// Simple validation (replaces Zod)
interface VerifyPaymentInput {
  orderId: string;
  status: string | number;
  description?: string;
  transactionRefId?: string;
  operatorRefId?: string;
  currency?: string;
  amount?: string | number;
}

function validateVerifyPaymentInput(body: unknown): { data: VerifyPaymentInput; error: null } | { data: null; error: string } {
  if (!body || typeof body !== "object") return { data: null, error: "Invalid body" };
  const b = body as Record<string, unknown>;
  
  const orderId = typeof b.orderId === "string" ? b.orderId : "";
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(orderId)) return { data: null, error: "orderId must be a valid UUID" };
  
  const status = b.status;
  if (status === undefined || status === null) return { data: null, error: "status is required" };
  
  return {
    data: {
      orderId,
      status: status as string | number,
      description: typeof b.description === "string" ? b.description.substring(0, 500) : "",
      transactionRefId: typeof b.transactionRefId === "string" ? b.transactionRefId.substring(0, 255) : "",
      operatorRefId: typeof b.operatorRefId === "string" ? b.operatorRefId.substring(0, 255) : "",
      currency: typeof b.currency === "string" ? b.currency.substring(0, 10) : undefined,
      amount: b.amount as string | number | undefined,
    },
    error: null,
  };
}

async function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature || !secret) return false;

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
    const computedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    if (computedSignature.length !== signature.length) return false;
    let result = 0;
    for (let i = 0; i < computedSignature.length; i++) {
      result |= computedSignature.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return result === 0;
  } catch (error) {
    console.error('[verify-payment] Signature verification error:', error);
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ success: false, error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const traceId = generateTraceId();

  try {
    console.log('[verify-payment] Request received, trace:', traceId);

    const rawBody = await req.text();
    
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid JSON body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const validationResult = validateVerifyPaymentInput(body);
    if (validationResult.error) {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid request data', details: validationResult.error }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { orderId, status, description, transactionRefId, operatorRefId } = validationResult.data;

    // Authorization check
    const webhookSecret = Deno.env.get('MAISHAPAY_WEBHOOK_SECRET');
    const signature = req.headers.get('x-webhook-signature');
    const authHeader = req.headers.get('authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    let isAuthorized = false;
    let authMethod = 'none';
    let authenticatedUserId: string | null = null;

    // Webhook signature
    if (webhookSecret && signature) {
      isAuthorized = await verifyWebhookSignature(rawBody, signature, webhookSecret);
      if (isAuthorized) authMethod = 'webhook';
    }

    // JWT token
    if (!isAuthorized && authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } }
      });

      const { data: { user }, error: authError } = await userClient.auth.getUser();
      if (!authError && user) {
        authenticatedUserId = user.id;
        isAuthorized = true;
        authMethod = 'jwt';
      }
    }

    // Service role
    if (!isAuthorized && authHeader === `Bearer ${supabaseServiceKey}`) {
      isAuthorized = true;
      authMethod = 'service_role';
    }

    if (!isAuthorized) {
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, status, user_id, total_usd, total_cdf, maisha_transaction_id, normalized_currency, exchange_rate_used')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ success: false, error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // JWT user must own the order
    if (authMethod === 'jwt' && authenticatedUserId && order.user_id !== authenticatedUserId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Already processed?
    if (['PAID', 'COMPLETED', 'SHIPPED', 'READY_FOR_PICKUP'].includes(order.status)) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'Order already processed',
          order: { id: order.id, status: order.status, totalUsd: order.total_usd, totalCdf: order.total_cdf },
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Must be PENDING_PAYMENT
    if (order.status !== 'PENDING_PAYMENT') {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid order state', message: `Order status is ${order.status}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize status using provider-specific logic (pawaPay or generic)
    const pawaStatus = normalizeProviderStatus('pawapay', String(status));
    const normalizedStatus = pawaStatus === 'succeeded' ? 'paid' : pawaStatus;
    console.log('[verify-payment] Status:', { raw: status, normalized: normalizedStatus });

    // Log to audit
    await logAudit(supabase, {
      traceId,
      eventType: 'VERIFY_PAYMENT_REQUEST',
      userId: order.user_id,
      orderId,
      payload: { normalizedStatus, authMethod },
    });

    // ============================================
    // P0 FIX: Use finalize_paid_order RPC for atomicity
    // ============================================
    if (normalizedStatus === 'paid') {
      const { data: rpcResult, error: rpcError } = await supabase.rpc('finalize_paid_order', {
        p_order_id: orderId,
        p_payment_ref: transactionRefId || order.maisha_transaction_id,
        p_operator_ref: operatorRefId || null,
        p_trace_id: traceId,
      });

      if (rpcError) {
        console.error('[verify-payment] finalize_paid_order RPC error:', rpcError);
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to finalize order' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      console.log('[verify-payment] finalize_paid_order result:', rpcResult);

      // Fetch updated order
      const { data: updatedOrder } = await supabase
        .from('orders')
        .select('id, status, total_usd, total_cdf, maisha_transaction_id, maisha_payment_status, operator_ref_id')
        .eq('id', orderId)
        .single();

      const orderRef = orderId.substring(0, 8).toUpperCase();
      const expectedCurrency = order.normalized_currency || 'USD';

      return new Response(
        JSON.stringify({
          success: true,
          order: {
            id: updatedOrder?.id || orderId,
            orderRef,
            status: updatedOrder?.status || 'PAID',
            paymentStatus: 'SUCCESS',
            totalUsd: updatedOrder?.total_usd,
            totalCdf: updatedOrder?.total_cdf,
            currency: expectedCurrency,
            exchangeRate: order.exchange_rate_used || 2500,
            transactionRef: updatedOrder?.maisha_transaction_id,
            operatorRef: updatedOrder?.operator_ref_id,
          },
          authMethod,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );

    } else {
      // Failed/cancelled - keep as PENDING_PAYMENT for retry
      const maishapayStatus = normalizedStatus === 'failed' ? 'FAILED' : normalizedStatus === 'cancelled' ? 'CANCELLED' : 'PENDING';
      
      await supabase.from('orders').update({
        maisha_payment_status: maishapayStatus,
        maisha_status_code: String(status),
        maisha_description: description || null,
        updated_at: new Date().toISOString(),
      }).eq('id', orderId);

      await supabase.from('maisha_payments').update({
        status: normalizedStatus,
        maishapay_status: maishapayStatus,
        maishapay_description: description || null,
        updated_at: new Date().toISOString(),
      }).eq('order_id', orderId);

      const orderRef = orderId.substring(0, 8).toUpperCase();

      return new Response(
        JSON.stringify({
          success: true,
          order: {
            id: orderId,
            orderRef,
            status: 'PENDING_PAYMENT',
            paymentStatus: maishapayStatus,
            totalUsd: order.total_usd,
            totalCdf: order.total_cdf,
          },
          authMethod,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

  } catch (error: unknown) {
    console.error('[verify-payment] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
