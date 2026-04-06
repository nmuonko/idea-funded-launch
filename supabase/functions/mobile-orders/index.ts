/**
 * mobile-orders — Consolidated Orders Router (INLINED)
 * 
 * Routes by `action` field in POST body:
 *   create, list, get_by_id, status, checkout, request_quote
 * 
 * AUTH: All actions require a valid JWT.
 * 
 * Batch 9: Business logic inlined from:
 *   - mobile-create-order-from-cart
 *   - mobile-get-orders
 *   - mobile-get-order-by-id
 *   - mobile-order-status
 * Phase 2: Proxy additions:
 *   - checkout → mobile-checkout
 *   - request_quote → mobile-request-quote
 */

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { 
  extractRequestToken,
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse,
  corsHeaders,
  buildForwardHeaders,
  extractDownstreamAuthFailure,
  authErrorResponse,
} from "../_shared/auth.ts";

// ─── Proxy Helper (for actions not yet inlined) ──────────

async function proxyToFunction(functionName: string, req: Request, body: unknown, token?: string | null): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const headers = buildForwardHeaders(req, token, { includeApiKey: true, contentType: 'application/json' });
  const { action: _a, ...payload } = body as any;
  const action = (body as any)?.action || 'unknown';

  const resp = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await resp.text();
  const authFailure = extractDownstreamAuthFailure(resp.status, text);

  console.log('[mobile-orders] proxy-downstream', {
    action,
    downstreamFunction: functionName,
    downstreamStatusCode: resp.status,
  });

  if (authFailure) {
    return authErrorResponse(authFailure.errorCode, authFailure.message, {
      action,
      downstream_function: functionName,
      downstream_status_code: resp.status,
    });
  }

  return new Response(text, {
    status: resp.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─── Shared Helpers ───────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;

const getDisplayRef = (id: string): string => id ? id.substring(0, 8).toUpperCase() : 'UNKNOWN';

const STATUS_MAP: Record<string, string> = {
  'DRAFT': 'PENDING_PAYMENT', 'PENDING_PAYMENT': 'PENDING_PAYMENT',
  'PAID': 'PAID', 'PROCESSING': 'PAID', 'PENDING_SHIPMENT': 'PENDING_SHIPMENT',
  'SHIPPED': 'SHIPPED', 'READY_FOR_PICKUP': 'DELIVERED', 
  'DELIVERED': 'DELIVERED', 'COMPLETED': 'DELIVERED', 'CANCELLED': 'CANCELLED',
};

const normalizeStatus = (s: string | null): string => s ? (STATUS_MAP[s.toUpperCase()] || s.toUpperCase()) : 'PENDING_PAYMENT';
const normalizeShippingStatus = (s: string | null): string => {
  if (!s) return 'pending';
  const l = s.toLowerCase();
  return l === 'shipped' ? 'shipped' : l === 'delivered' ? 'delivered' : 'pending';
};

function calculateShipping(itemsSubtotal: number, shippingBaseFee: number, shippingPercent: number): number {
  const normalizedPercent = shippingPercent > 1 ? shippingPercent / 100 : shippingPercent;
  return round2(shippingBaseFee + (itemsSubtotal * normalizedPercent));
}

function calculateCartSummary(
  items: any[], 
  shippingBaseFeeUsd: number, 
  shippingPercent: number,
  exchangeRate: number,
  markupPercent: number,
  vehicleMarkupPercent: number
) {
  let itemCount = 0;
  let totalItemsUsd = 0;
  let totalMarginUsd = 0;
  let totalShippingUsd = 0;
  let grandTotalUsd = 0;

  (items || []).forEach(item => {
    const qty = item.quantity || 1;
    itemCount += qty;
    
    const isQuotedVehicle = !!(item.is_vehicle && item.vehicle_quote_applied && Number(item.total_price_usd || 0) > 0);
    
    if (isQuotedVehicle) {
      const base = Number(item.base_price_usd || 0) * qty;
      const margin = Number(item.markup_fee_usd || 0);
      const shipping = Number(item.shipping_fee_usd || 0);
      const lineTotal = Number(item.total_price_usd || 0);
      
      totalItemsUsd += base;
      totalMarginUsd += margin;
      totalShippingUsd += shipping;
      grandTotalUsd += lineTotal;
      
      console.log(`[CREATE_ORDER] Quoted vehicle item=${item.id} base=${base} margin=${margin} shipping=${shipping} total=${lineTotal}`);
    } else {
      const base = round2(Number(item.base_price_usd || 0) * qty);
      const isVehicle = !!(item.is_vehicle || item.category_key?.startsWith('vehicle'));
      const effectiveMarkup = isVehicle ? vehicleMarkupPercent : markupPercent;
      const normalizedMarkup = effectiveMarkup > 1 ? effectiveMarkup / 100 : effectiveMarkup;
      const margin = round2(base * normalizedMarkup);
      const subtotalWithMargin = round2(base + margin);
      
      totalItemsUsd += base;
      totalMarginUsd += margin;
      grandTotalUsd += subtotalWithMargin;
      
      console.log(`[CREATE_ORDER] Regular item=${item.id} base=${base} markup=${effectiveMarkup}% margin=${margin} subtotal=${subtotalWithMargin}`);
    }
  });

  const nonQuotedBase = (items || [])
    .filter((item: any) => !(item.is_vehicle && item.vehicle_quote_applied && Number(item.total_price_usd || 0) > 0))
    .reduce((sum: number, item: any) => sum + round2(Number(item.base_price_usd || 0) * (item.quantity || 1)), 0);
  
  const regularShipping = nonQuotedBase > 0 
    ? calculateShipping(nonQuotedBase, shippingBaseFeeUsd, shippingPercent) 
    : 0;
  
  totalShippingUsd += regularShipping;
  grandTotalUsd = round2(grandTotalUsd + regularShipping);
  const grandTotalCdf = round2(grandTotalUsd * exchangeRate);

  return {
    itemCount,
    totalItemsUsd: round2(totalItemsUsd),
    totalMarginUsd: round2(totalMarginUsd),
    itemsSubtotalUsd: round2(totalItemsUsd + totalMarginUsd),
    shippingFeeUsd: round2(totalShippingUsd),
    grandTotalUsd,
    grandTotalCdf,
    exchangeRate,
  };
}

// ─── Action: create ───────────────────────────────────────

async function handleCreate(user: any, supabase: any, url: URL): Promise<Response> {
  const correlationId = crypto.randomUUID().slice(0, 8);
  const startTime = Date.now();
  const env = url.searchParams.get('env') || 'prod';
  
  console.log(`[CREATE_ORDER] start correlationId=${correlationId} env=${env}`);

  // Get existing DRAFT order with items
  let { data: existingOrder, error: orderFetchError } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('user_id', user.id)
    .eq('status', 'DRAFT')
    .maybeSingle();

  if (orderFetchError) {
    console.error(`[CREATE_ORDER][ERROR] correlationId=${correlationId} code=DB_FETCH_ERROR message=${orderFetchError.message}`);
    return jsonResponse({ 
      ok: false, success: false, error: 'DB_FETCH_ERROR', 
      message: 'Failed to fetch cart data.', correlationId,
      details: orderFetchError.message 
    }, 200);
  }

  // FALLBACK: Check for a recent PENDING_PAYMENT order that can be reused
  if (!existingOrder) {
    console.log(`[CREATE_ORDER] correlationId=${correlationId} No draft order found, checking for recent PENDING_PAYMENT...`);
    
    const { data: pendingOrder, error: pendingFetchError } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('user_id', user.id)
      .eq('status', 'PENDING_PAYMENT')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pendingFetchError) {
      console.error(`[CREATE_ORDER] correlationId=${correlationId} Error fetching pending order:`, pendingFetchError.message);
    }

    if (pendingOrder && pendingOrder.order_items && pendingOrder.order_items.length > 0) {
      const updatedAt = new Date(pendingOrder.updated_at);
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
      
      if (updatedAt > thirtyMinutesAgo) {
        console.log(`[CREATE_ORDER] correlationId=${correlationId} Reusing recent PENDING_PAYMENT order: orderId=${pendingOrder.id}`);
        existingOrder = pendingOrder;
      }
    }
  }

  if (!existingOrder || !existingOrder.order_items || existingOrder.order_items.length === 0) {
    return jsonResponse({ 
      ok: false, success: false, error: 'EMPTY_CART', 
      message: 'Your cart is empty. Please add items before checkout.', correlationId,
    }, 200);
  }

  console.log(`[CREATE_ORDER] correlationId=${correlationId} Found order: orderId=${existingOrder.id} itemCount=${existingOrder.order_items.length}`);

  // Get pricing settings from cache — use admin client to bypass RLS on settings table
  const { getCachedGlobalSettings } = await import("../_shared/settingsMemoryCache.ts");
  const adminClient = createAdminClient();
  const settings = await getCachedGlobalSettings(adminClient) as Record<string, any>;

  if (!settings || Object.keys(settings).length === 0) {
    return jsonResponse({ 
      ok: false, success: false, error: 'SETTINGS_ERROR', 
      message: 'Failed to load pricing configuration.', correlationId,
    }, 200);
  }

  const exchangeRate = settings.exchange_rate_usd_to_cdf ?? 2800;
  const shippingBaseFeeUsd = settings.shipping_base_fee_usd ?? 20;
  const shippingPercent = settings.shipping_percent ?? 0.10;
  const markupPercent = settings.markup_percent ?? settings.global_markup_percent ?? 30;
  const vehicleMarkupPercent = settings.vehicle_markup_percent ?? settings.category_markups?.vehicles ?? 10;

  const summary = calculateCartSummary(
    existingOrder.order_items, shippingBaseFeeUsd, shippingPercent, 
    exchangeRate, markupPercent, vehicleMarkupPercent
  );

  console.log(`[CREATE_ORDER] correlationId=${correlationId} Calculated totals: grandTotalUsd=${summary.grandTotalUsd}`);

  const { data: updatedOrder, error: updateError } = await supabase
    .from('orders')
    .update({
      status: 'PENDING_PAYMENT',
      item_total_usd: summary.totalItemsUsd,
      service_fee_usd: summary.totalMarginUsd,
      shipping_fee_usd: summary.shippingFeeUsd,
      total_usd: summary.grandTotalUsd,
      total_cdf: summary.grandTotalCdf,
      exchange_rate_used: exchangeRate,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existingOrder.id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (updateError || !updatedOrder) {
    console.error(`[CREATE_ORDER][ERROR] correlationId=${correlationId} code=DB_ORDER_UPDATE_FAILED`);
    return jsonResponse({ 
      ok: false, success: false, error: 'DB_ORDER_UPDATE_FAILED', 
      message: 'Failed to finalize order. Please try again.', correlationId,
    }, 200);
  }

  const elapsedMs = Date.now() - startTime;
  console.log(`[CREATE_ORDER] success correlationId=${correlationId} orderId=${updatedOrder.id} totalUsd=${updatedOrder.total_usd} ms=${elapsedMs}`);

  const orderItemIds = existingOrder.order_items.map((item: any) => item.id);

  return jsonResponse({
    ok: true, success: true, correlationId,
    order_id: updatedOrder.id, order_item_ids: orderItemIds,
    orderId: updatedOrder.id, orderItemIds: orderItemIds,
    order: {
      id: updatedOrder.id, status: updatedOrder.status,
      itemCount: summary.itemCount, totalItemsUsd: summary.totalItemsUsd,
      totalMarginUsd: summary.totalMarginUsd, shippingFeeUsd: summary.shippingFeeUsd,
      grandTotalUsd: summary.grandTotalUsd, grandTotalCdf: summary.grandTotalCdf,
      exchangeRate,
    }
  }, 200);
}

// ─── Action: list ─────────────────────────────────────────

async function handleList(user: any, supabase: any, url: URL): Promise<Response> {
  const startTime = Date.now();
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20')));
  const offset = (page - 1) * pageSize;

  const { count: totalCount, error: countError } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .neq('status', 'DRAFT');

  const { data: orders, error } = await supabase
    .from('orders')
    .select(`
      id, created_at, total_usd, total_cdf, item_total_usd, service_fee_usd, shipping_fee_usd,
      status, tracking_number, carrier, shipped_at, estimated_delivery,
      order_items(id, title, store, product_url, product_image_url, base_price_usd, unit_price_usd, subtotal_usd, quantity, total_price_usd, shipping_status),
      payment_attempts(confirmation_code)
    `)
    .eq('user_id', user.id)
    .neq('status', 'DRAFT')
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) {
    console.error(`[mobile-get-orders] Query error:`, error.message);
    return errorResponse('Failed to fetch orders', 500);
  }

  const formattedOrders = (orders || []).map((o: any) => {
    const displayRef = getDisplayRef(o.id);
    const confirmationCode = o.payment_attempts?.[0]?.confirmation_code || null;
    
    return {
      id: o.id, displayRef,
      totalUsd: Number(o.total_usd) || 0, totalCdf: Number(o.total_cdf) || 0,
      itemTotalUsd: Number(o.item_total_usd) || 0, serviceFeeUsd: Number(o.service_fee_usd) || 0,
      shippingFeeUsd: Number(o.shipping_fee_usd) || 0,
      status: normalizeStatus(o.status), paymentStatus: 'PENDING',
      createdAt: o.created_at, trackingNumber: o.tracking_number,
      carrier: o.carrier, shippedAt: o.shipped_at, estimatedDelivery: o.estimated_delivery,
      confirmationCode,
      itemCount: o.order_items?.length || 0,
      items: (o.order_items || []).map((item: any) => {
        const basePrice = Number(item.base_price_usd) || Number(item.unit_price_usd) || 0;
        const qty = Number(item.quantity) || 1;
        const subtotal = Number(item.subtotal_usd) || (basePrice * qty);
        const imgUrl = item.product_image_url || null;
        return {
          id: item.id, title: item.title || 'Product', store: item.store,
          productUrl: item.product_url, imageUrl: imgUrl, image_url: imgUrl,
          priceUsd: basePrice, unitPriceUsd: basePrice, quantity: qty,
          subtotalUsd: subtotal, totalUsd: Number(item.total_price_usd) || subtotal,
          shippingStatus: normalizeShippingStatus(item.shipping_status),
        };
      }),
    };
  });

  const fetchedCount = formattedOrders.length;
  const hasMore = totalCount !== null ? (offset + fetchedCount) < totalCount : fetchedCount === pageSize;

  console.log(`[mobile-get-orders] PERF total=${Date.now() - startTime}ms - ${formattedOrders.length} orders`);

  return jsonResponse({
    ok: true, success: true, orders: formattedOrders,
    page, pageSize, total_count: totalCount || 0, hasMore, has_more: hasMore,
  });
}

// ─── Action: get_by_id ────────────────────────────────────

async function handleGetById(user: any, supabase: any, url: URL, body: any): Promise<Response> {
  const startTime = Date.now();
  const orderId = body?.order_id || body?.orderId || url.searchParams.get('id') || url.searchParams.get('orderId');

  if (!orderId) {
    return jsonResponse({ ok: false, success: false, code: 'MISSING_ORDER_ID', error: 'Order ID required' }, 400);
  }

  const { data: order, error } = await supabase
    .from('orders')
    .select(`
      id, created_at, total_usd, total_cdf, item_total_usd, service_fee_usd, shipping_fee_usd,
      exchange_rate_used, status, tracking_number, carrier,
      shipped_at, delivered_at, estimated_delivery,
      order_items(id, title, store, product_url, product_image_url, base_price_usd, unit_price_usd, subtotal_usd, markup_fee_usd, quantity, total_price_usd, total_price_cdf, shipping_status),
      payment_attempts(confirmation_code, paid_at, status)
    `)
    .eq('id', orderId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error(`[mobile-get-order-by-id] Query error:`, error.message);
    return errorResponse('Failed to fetch order', 500);
  }

  if (!order) {
    return jsonResponse({ ok: false, success: false, code: 'NOT_FOUND', error: 'Order not found' }, 404);
  }

  const displayRef = getDisplayRef(order.id);
  const payment = order.payment_attempts?.[0] || null;

  console.log(`[mobile-get-order-by-id] PERF total=${Date.now() - startTime}ms - Order ${orderId.substring(0, 8)}`);

  return jsonResponse({
    ok: true, success: true,
    order: {
      id: order.id, displayRef,
      totalUsd: Number(order.total_usd) || 0, totalCdf: Number(order.total_cdf) || 0,
      itemTotalUsd: Number(order.item_total_usd) || 0, serviceFeeUsd: Number(order.service_fee_usd) || 0,
      shippingFeeUsd: Number(order.shipping_fee_usd) || 0,
      exchangeRate: Number(order.exchange_rate_used) || 2800,
      status: normalizeStatus(order.status),
      paymentStatus: payment?.status || 'PENDING',
      createdAt: order.created_at, paidAt: payment?.paid_at,
      shippedAt: order.shipped_at, deliveredAt: order.delivered_at,
      estimatedDelivery: order.estimated_delivery,
      trackingNumber: order.tracking_number, carrier: order.carrier,
      confirmationCode: payment?.confirmation_code,
      items: (order.order_items || []).map((item: any) => {
        const basePrice = Number(item.base_price_usd) || Number(item.unit_price_usd) || 0;
        const qty = Number(item.quantity) || 1;
        const subtotal = Number(item.subtotal_usd) || (basePrice * qty);
        const totalWithMarkup = Number(item.total_price_usd) || subtotal;
        const imgUrl = item.product_image_url || null;
        return {
          id: item.id, title: item.title || 'Product', store: item.store,
          productUrl: item.product_url, imageUrl: imgUrl, image_url: imgUrl,
          priceUsd: basePrice, unitPriceUsd: basePrice, quantity: qty,
          subtotalUsd: subtotal, totalUsd: totalWithMarkup,
          markupFeeUsd: Number(item.markup_fee_usd) || 0,
          shippingStatus: normalizeShippingStatus(item.shipping_status),
        };
      }),
    },
  });
}

// ─── Action: status ───────────────────────────────────────

async function handleStatus(user: any, supabase: any, url: URL, body: any): Promise<Response> {
  const orderId = body?.order_id || body?.orderId || url.searchParams.get('order_id') || url.searchParams.get('orderId');

  if (!orderId) {
    return jsonResponse({ success: false, error: 'order_id query parameter is required' }, 400);
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id, status, total_usd, total_cdf, payment_verified_at')
    .eq('id', orderId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (orderError) {
    console.error('[mobile-order-status] DB error:', orderError);
    return errorResponse('Failed to fetch order', 500);
  }

  if (!order) {
    return jsonResponse({ error: 'ORDER_NOT_FOUND', message: 'Order not found' }, 404);
  }

  let paymentStatus: 'paid' | 'pending' | 'failed' | 'cancelled' = 'pending';
  if (['PAID', 'PROCESSING', 'SHIPPED', 'READY_FOR_PICKUP', 'COMPLETED'].includes(order.status)) {
    paymentStatus = 'paid';
  } else if (order.status === 'CANCELLED') {
    paymentStatus = 'cancelled';
  }

  const responseBody = {
    success: true,
    orderId: order.id, paymentStatus, orderStatus: order.status,
    totalUsd: order.total_usd, totalCdf: order.total_cdf, paidAt: order.payment_verified_at,
    order_id: order.id, payment_status: paymentStatus, order_status: order.status,
    total_usd: order.total_usd, total_cdf: order.total_cdf, paid_at: order.payment_verified_at,
  };
  
  console.log('[mobile-order-status] response:', JSON.stringify(responseBody));
  return jsonResponse(responseBody);
}

// ─── Router ───────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    // Pre-extract token to ensure consistent auth across all paths
    const { token, source: tokenSource } = await extractRequestToken(req);
    const hasAuthorizationHeader = !!req.headers.get('Authorization');

    console.log('[mobile-orders] auth-check', {
      tokenSource: tokenSource || 'missing',
      hasAuthorizationHeader,
      hasExtractedToken: !!token,
      alternateHeaders: {
        'x-auth-token': !!req.headers.get('x-auth-token'),
        'x-session-token': !!req.headers.get('x-session-token'),
        'x-access-token': !!req.headers.get('x-access-token'),
        'x-jwt': !!req.headers.get('x-jwt'),
      },
    });

    if (!token) {
      console.warn('[mobile-orders] NO_TOKEN', { hasAuthorizationHeader });
      return jsonResponse({
        ok: false, success: false,
        error: 'NO_TOKEN', error_code: 'NO_TOKEN',
        message: 'No authentication token found. Please sign in.',
        authenticated: false,
      }, 200);
    }

    let user: any;
    let supabase: any;
    try {
      const authResult = await verifyAndGetUser(req, undefined, { token, source: tokenSource });
      user = authResult.user;
      supabase = authResult.supabase;
    } catch (authError: any) {
      const errorCode = authError?.authErrorCode || 'INVALID_TOKEN';
      console.warn('[mobile-orders] auth-failed', {
        tokenSource, hasAuthorizationHeader, errorCode,
        reason: authError?.message,
      });
      return jsonResponse({
        ok: false, success: false,
        error: errorCode, error_code: errorCode,
        message: errorCode === 'EXPIRED_TOKEN'
          ? 'Session expired. Please sign in again.'
          : 'Authentication failed. Please sign in again.',
        authenticated: false,
      }, 200);
    }

    console.log('[mobile-orders] auth-ok', { userId: user.id.slice(0, 8) + '***', tokenSource });

    const url = new URL(req.url);
    let action = 'list';
    let body: any = {};

    if (req.method === 'GET') {
      action = url.searchParams.get('action') || 'list';
    } else {
      try {
        body = await req.json();
        action = body.action || 'create';
      } catch {
        return jsonResponse({ ok: false, error: 'Invalid JSON body' }, 400);
      }
    }

    console.log(`[mobile-orders] action=${action}`);

    switch (action) {
      case 'create':
        return handleCreate(user, supabase, url);
      case 'list':
        return handleList(user, supabase, url);
      case 'get_by_id':
        return handleGetById(user, supabase, url, body);
      case 'status':
        return handleStatus(user, supabase, url, body);
      case 'checkout':
      case 'request_quote':
        return proxyToFunction(action === 'checkout' ? 'mobile-checkout' : 'mobile-request-quote', req, body, token);
      default:
        return jsonResponse({ ok: false, error: `Unknown action: ${action}` }, 400);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[mobile-orders] Error:', msg);
    return jsonResponse({ ok: false, error: msg }, 500);
  }
});
