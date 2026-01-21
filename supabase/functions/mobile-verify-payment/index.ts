import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse,
} from "../_shared/auth.ts";
import { checkRateLimit, getClientIp, rateLimitExceededResponse } from "../_shared/rateLimiter.ts";
import { generateTraceId, createTracedLogger } from "../_shared/auditLog.ts";
import { 
  getPaymentByOrderId, 
  getProviderByKey,
  normalizePaymentStatus,
  updatePaymentStatus,
} from "../_shared/paymentProviders.ts";
import { verifyDeposit, getPawaPayConfig } from "../_shared/pawapayAdapter.ts";
import { verifyPaymentIntent, getStripeConfig } from "../_shared/stripeAdapter.ts";

/**
 * mobile-verify-payment Edge Function
 * 
 * Authoritative source for transaction results.
 * MaishaPay REMOVED - only supports pawaPay verification.
 * 
 * Supports both GET (query params) and POST (JSON body):
 * - orderId: Primary lookup key
 * - reference: Alternative lookup by payment reference
 * 
 * Response schema:
 * { success: true, status: 'pending'|'succeeded'|'failed', order_id: 'uuid', paid_at?: string, error?: string }
 */
serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  // Support both GET and POST for flexibility
  if (req.method !== 'GET' && req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  const traceId = generateTraceId();
  const log = createTracedLogger(traceId);

  try {
    log.log('[verify-payment] Started');

    const { user, supabase } = await verifyAndGetUser(req);
    log.log('[verify-payment] User authenticated', { userId: user.id });

    // Rate limiting: 30 requests per 10 minutes per user
    const clientIp = getClientIp(req);
    const rateLimitResult = await checkRateLimit(
      supabase,
      `user:${user.id}:verify-payment`,
      30,
      10
    );

    if (!rateLimitResult.allowed) {
      log.warn('[verify-payment] Rate limit exceeded', { 
        userId: user.id, 
        count: rateLimitResult.count,
        limit: rateLimitResult.limit,
      });
      return rateLimitExceededResponse(
        { 
          allowed: false, 
          user_result: rateLimitResult,
          blocked_by: 'user',
        },
        'verify-payment'
      );
    }

    // Parse order_id from query params (GET) or body (POST)
    let order_id: string | null = null;
    let reference: string | null = null;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      order_id = url.searchParams.get('orderId') || url.searchParams.get('order_id');
      reference = url.searchParams.get('reference');
    } else {
      const body = await req.json();
      order_id = body.order_id || body.orderId;
      reference = body.reference;
    }

    log.log('[verify-payment] Params', { order_id, reference });

    if (!order_id && !reference) {
      return jsonResponse({ 
        success: false, 
        code: 'MISSING_PARAM',
        message: 'order_id or reference is required',
        error: 'order_id or reference is required',
      }, 400);
    }

    // Find the order with item count
    let query = supabase.from('orders').select('*, order_items(id)');
    
    if (order_id) {
      query = query.eq('id', order_id);
    } else if (reference) {
      query = query.eq('maisha_transaction_id', reference);
    }

    const { data: order, error: orderError } = await query.eq('user_id', user.id).single();

    if (orderError || !order) {
      log.warn('[verify-payment] Order not found', { order_id, reference });
      return jsonResponse({ 
        success: false, 
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
        error: 'Order not found',
      }, 404);
    }

    // ==================== CHECK IF ALREADY PAID ====================
    
    if (order.status === 'PAID' || order.maisha_payment_status === 'SUCCESS') {
      log.log('[verify-payment] Order already paid', { orderId: order.id });
      return jsonResponse({
        success: true,
        order_id: order.id,
        status: 'succeeded',
        paid_at: order.payment_verified_at || order.approved_at,
      });
    }

    // ==================== CHECK UNIFIED PAYMENTS TABLE ====================
    
    const unifiedPayment = await getPaymentByOrderId(supabase, order.id);
    
    if (unifiedPayment) {
      log.log('[verify-payment] Found payment record', { 
        paymentId: unifiedPayment.id,
        provider: unifiedPayment.provider_key,
        status: unifiedPayment.status,
      });

      // ==================== PAWAPAY VERIFICATION ====================
      if (unifiedPayment.provider_key === 'pawapay') {
        log.log('[verify-payment] Using pawaPay verification', { paymentId: unifiedPayment.id });
        
        // Check if already completed in DB
        if (unifiedPayment.status === 'succeeded') {
          return jsonResponse({
            success: true,
            order_id: order.id,
            status: 'succeeded',
            paid_at: unifiedPayment.paid_at || order.payment_verified_at,
          });
        }
        
        // Verify with pawaPay API if deposit ID exists
        if (unifiedPayment.provider_deposit_id) {
          try {
            const provider = await getProviderByKey(supabase, 'pawapay');
            if (provider) {
              const pawaConfig = getPawaPayConfig(provider);
              const verifyResult = await verifyDeposit(pawaConfig, unifiedPayment.provider_deposit_id);
              
              log.log('[verify-payment] pawaPay verify result', { 
                status: verifyResult.status,
                success: verifyResult.success,
              });
              
              if (verifyResult.status === 'succeeded') {
                // Update payment and order status
                await updatePaymentStatus(supabase, unifiedPayment.id, 'succeeded', {
                  provider_transaction_id: verifyResult.provider_transaction_id,
                  paid_at: verifyResult.paid_at,
                });
                
                // Update order status
                await supabase.from('orders').update({
                  status: 'PAID',
                  maisha_payment_status: 'SUCCESS',
                  payment_verified_at: new Date().toISOString(),
                }).eq('id', order.id);
                
                // P0 FIX: Fetch checkout_session to get original cart item IDs
                const { data: checkoutSession } = await supabase
                  .from('checkout_sessions')
                  .select('id, metadata')
                  .eq('order_id', order.id)
                  .maybeSingle();
                
                // P0 FIX: Mark checkout_session as completed
                if (checkoutSession?.id) {
                  await supabase.from('checkout_sessions').update({
                    status: 'completed',
                    paid_at: new Date().toISOString(),
                  }).eq('id', checkoutSession.id);
                }
                
                // P0 CRITICAL FIX: Clear cart items ONLY on verified success
                // Delete original items from the DRAFT order (cart)
                const metadata = checkoutSession?.metadata as any;
                const originalCartItemIds = metadata?.original_cart_item_ids || metadata?.cart_item_ids;
                const sourceOrderId = metadata?.source_order_id;
                
                if (originalCartItemIds && Array.isArray(originalCartItemIds) && originalCartItemIds.length > 0) {
                  log.log('[verify-payment] Deleting original cart items from DRAFT order', {
                    source_order_id: sourceOrderId,
                    original_cart_item_ids: originalCartItemIds,
                    count: originalCartItemIds.length,
                  });
                  
                  const { error: deleteError, data: deletedItems } = await supabase
                    .from('order_items')
                    .delete()
                    .in('id', originalCartItemIds)
                    .select('id');
                  
                  if (deleteError) {
                    log.error('[verify-payment] Failed to delete original cart items', { 
                      error: deleteError.message,
                      original_cart_item_ids: originalCartItemIds,
                    });
                  } else {
                    log.log('[verify-payment] Successfully deleted original cart items', {
                      deleted_count: deletedItems?.length || 0,
                      deleted_ids: deletedItems?.map(i => i.id),
                    });
                  }
                } else {
                  log.log('[verify-payment] Payment succeeded, no original cart item IDs found in session');
                }
                
                return jsonResponse({
                  success: true,
                  order_id: order.id,
                  status: 'succeeded',
                  paid_at: verifyResult.paid_at || new Date().toISOString(),
                });
              }
              
              if (verifyResult.status === 'failed') {
                await updatePaymentStatus(supabase, unifiedPayment.id, 'failed');
                
                return jsonResponse({
                  success: true,
                  order_id: order.id,
                  status: 'failed',
                  error: verifyResult.error || 'Payment failed',
                });
              }
              
              // Still pending
              return jsonResponse({
                success: true,
                order_id: order.id,
                status: 'pending',
              });
            }
          } catch (pawaError: any) {
            log.error('[verify-payment] pawaPay verify error', { error: pawaError.message });
            // Fall through to return pending status
          }
        }
        
        // Return current status from DB
        const mappedStatus = normalizePaymentStatus('pawapay', unifiedPayment.status);
        return jsonResponse({
          success: true,
          order_id: order.id,
          status: mappedStatus === 'succeeded' ? 'succeeded' : mappedStatus === 'failed' ? 'failed' : 'pending',
          paid_at: unifiedPayment.paid_at || undefined,
        });
      }

      // ==================== STRIPE VERIFICATION ====================
      if (unifiedPayment.provider_key === 'stripe') {
        log.log('[verify-payment] Using Stripe verification', { paymentId: unifiedPayment.id });
        
        // Check if already completed in DB
        if (unifiedPayment.status === 'succeeded') {
          return jsonResponse({
            success: true,
            order_id: order.id,
            status: 'succeeded',
            paid_at: unifiedPayment.paid_at || order.payment_verified_at,
          });
        }
        
        // If still pending/processing and we have Stripe PI ID, verify with Stripe API
        if (unifiedPayment.provider_deposit_id && 
            ['pending', 'processing', 'requires_action'].includes(unifiedPayment.status || '')) {
          try {
            const stripeProvider = await getProviderByKey(supabase, 'stripe');
            if (stripeProvider) {
              const stripeConfig = getStripeConfig(stripeProvider);
              const stripeResult = await verifyPaymentIntent(stripeConfig, unifiedPayment.provider_deposit_id);
              
              // Diagnostic log line
              log.log('[STRIPE_RECONCILE]', {
                orderId: order.id,
                paymentId: unifiedPayment.id,
                stripePaymentIntentId: unifiedPayment.provider_deposit_id,
                dbStatus: unifiedPayment.status,
                stripeStatus: stripeResult.status,
              });
              
              // Handle succeeded
              if (stripeResult.status === 'succeeded') {
                // Update payment status
                await updatePaymentStatus(supabase, unifiedPayment.id, 'succeeded', {
                  provider_transaction_id: stripeResult.provider_transaction_id,
                  paid_at: stripeResult.paid_at,
                });
                
                // Update order status
                await supabase.from('orders').update({
                  status: 'PAID',
                  maisha_payment_status: 'SUCCESS',
                  payment_verified_at: new Date().toISOString(),
                }).eq('id', order.id);
                
                // Clear cart items (same logic as pawaPay)
                const { data: checkoutSession } = await supabase
                  .from('checkout_sessions')
                  .select('id, metadata')
                  .eq('order_id', order.id)
                  .maybeSingle();
                
                if (checkoutSession?.id) {
                  await supabase.from('checkout_sessions').update({
                    status: 'completed',
                    paid_at: new Date().toISOString(),
                  }).eq('id', checkoutSession.id);
                }
                
                const metadata = checkoutSession?.metadata as any;
                const originalCartItemIds = metadata?.original_cart_item_ids || metadata?.cart_item_ids;
                
                if (originalCartItemIds && Array.isArray(originalCartItemIds) && originalCartItemIds.length > 0) {
                  log.log('[verify-payment] Stripe: Deleting original cart items', {
                    count: originalCartItemIds.length,
                  });
                  await supabase.from('order_items').delete().in('id', originalCartItemIds);
                }
                
                return jsonResponse({
                  success: true,
                  order_id: order.id,
                  status: 'succeeded',
                  stripeStatus: 'succeeded',
                  paid_at: stripeResult.paid_at || new Date().toISOString(),
                });
              }
              
              // Handle failed/canceled
              if (stripeResult.status === 'failed') {
                await updatePaymentStatus(supabase, unifiedPayment.id, 'failed');
                
                return jsonResponse({
                  success: true,
                  order_id: order.id,
                  status: 'failed',
                  stripeStatus: stripeResult.status,
                  error: 'requires_payment_method',
                });
              }
              
              // Still processing/pending
              return jsonResponse({
                success: true,
                order_id: order.id,
                status: 'processing',
                stripeStatus: stripeResult.status,
              });
            }
          } catch (stripeError: any) {
            log.error('[verify-payment] Stripe verify error', { error: stripeError.message });
            // Fall through to return current DB status
          }
        }
        
        // Fallback: return current DB status
        const mappedStatus = unifiedPayment.status === 'succeeded' ? 'succeeded' : 
                            unifiedPayment.status === 'failed' ? 'failed' : 'pending';
        return jsonResponse({
          success: true,
          order_id: order.id,
          status: mappedStatus,
          paid_at: unifiedPayment.paid_at || undefined,
        });
      }

      // ==================== OTHER PROVIDERS ====================
      // Return current status from DB
      const mappedStatus = unifiedPayment.status === 'succeeded' ? 'succeeded' : 
                          unifiedPayment.status === 'failed' ? 'failed' : 'pending';
      return jsonResponse({
        success: true,
        order_id: order.id,
        status: mappedStatus,
        paid_at: unifiedPayment.paid_at || undefined,
      });
    }

    // ==================== NO PAYMENT RECORD FOUND ====================
    
    log.log('[verify-payment] No payment record found, checking order status', { orderId: order.id });
    
    // Check order status directly
    if (order.status === 'PENDING_PAYMENT') {
      return jsonResponse({
        success: true,
        order_id: order.id,
        status: 'pending',
      });
    }
    
    if (order.status === 'CANCELLED' || order.status === 'REJECTED') {
      return jsonResponse({
        success: true,
        order_id: order.id,
        status: 'failed',
        error: 'Order was cancelled',
      });
    }

    // Default to pending
    return jsonResponse({
      success: true,
      order_id: order.id,
      status: 'pending',
    });

  } catch (error: any) {
    log.error('[verify-payment] Error', { message: error.message });
    
    if (error.name === 'AuthError') {
      return jsonResponse({ 
        success: false,
        code: 'AUTH_ERROR',
        message: error.message,
        error: error.message,
      }, error.status);
    }
    
    return jsonResponse({ 
      success: false,
      code: 'INTERNAL_ERROR', 
      message: 'An unexpected error occurred',
      error: error.message,
    }, 500);
  }
});
