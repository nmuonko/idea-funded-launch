import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse,
} from "../_shared/auth.ts";
import { createReferralCommission } from "../_shared/referralCommission.ts";
import { checkRateLimit, getClientIp, rateLimitExceededResponse } from "../_shared/rateLimiter.ts";
import { generateTraceId, createTracedLogger } from "../_shared/auditLog.ts";
import { 
  getPaymentByOrderId, 
  getProviderByKey,
  normalizePaymentStatus,
  updatePaymentStatus,
} from "../_shared/paymentProviders.ts";
import { verifyDeposit, getPawaPayConfig } from "../_shared/pawapayAdapter.ts";
import { verifyPaymentIntent, verifyCheckoutSession, getStripeConfig } from "../_shared/stripeAdapter.ts";

/**
 * mobile-verify-payment Edge Function
 * 
 * Authoritative source for transaction results.
 * Supports pawaPay and Stripe verification with provider API fallback.
 * 
 * Supports both GET (query params) and POST (JSON body):
 * - orderId: Primary lookup key (also accepts order_id for compatibility)
 * - reference: Alternative lookup by payment reference
 * 
 * RESPONSE CONTRACT (MOBILE APP COMPATIBILITY):
 * 
 * SUCCESS: 
 *   { success: true, status: 'paid', payment_status: 'paid', order_id: 'uuid', paid_at: 'ISO' }
 *   Returns 'paid' for maximum mobile app compatibility (not 'succeeded')
 * 
 * PENDING: 
 *   { success: true, status: 'pending', payment_status: 'pending' }
 * 
 * FAILED:  
 *   { success: false, status: 'failed', payment_status: 'failed', error: 'message', error_code: 'CODE' }
 * 
 * CRITICAL: 
 * - Returns 'paid' not 'succeeded' for mobile app compatibility
 * - Both 'status' and 'payment_status' fields are set for backwards compatibility
 * - success: true/false is required
 * - paid_at is required for success responses
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
    log.log('[PAYMENT_VERIFY] Started');

    const { user, supabase } = await verifyAndGetUser(req);
    log.log('[PAYMENT_VERIFY] User authenticated', { userId: user.id.slice(0, 8) + '***' });

    // Rate limiting: 30 requests per 10 minutes per user
    const clientIp = getClientIp(req);
    const rateLimitResult = await checkRateLimit(
      supabase,
      `user:${user.id}:verify-payment`,
      30,
      10
    );

    if (!rateLimitResult.allowed) {
      log.warn('[PAYMENT_VERIFY] Rate limit exceeded', { 
        userId: user.id.slice(0, 8) + '***', 
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
    // IMPORTANT: Accept BOTH orderId and order_id for compatibility
    let order_id: string | null = null;
    let reference: string | null = null;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      order_id = url.searchParams.get('orderId') || url.searchParams.get('order_id');
      reference = url.searchParams.get('reference');
    } else {
      const body = await req.json();
      order_id = body.orderId || body.order_id;
      reference = body.reference;
    }

    log.log('[PAYMENT_VERIFY] Params', { order_id, reference });

    if (!order_id && !reference) {
      return jsonResponse({ 
        success: false, 
        status: 'failed',
        error: 'order_id or reference is required',
        error_code: 'MISSING_PARAMS',
      }, 400);
    }

    // Find the order with item count
    let query = supabase.from('orders').select('*, order_items(id)');
    
    if (order_id) {
      query = query.eq('id', order_id);
    }

    const { data: order, error: orderError } = await query.eq('user_id', user.id).single();

    if (orderError || !order) {
      log.warn('[PAYMENT_VERIFY] Order not found', { order_id, reference });
      return jsonResponse({ 
        success: false, 
        status: 'failed',
        error: 'Order not found',
        error_code: 'ORDER_NOT_FOUND',
      }, 404);
    }

    // ==================== CHECK IF ALREADY PAID ====================
    
    if (order.status === 'PAID') {
      log.log('[PAYMENT_VERIFY] Order already paid', { orderId: order.id });
      
      // Try to send confirmation email if not sent yet
      await sendPaymentConfirmationEmailIfNeeded(supabase, order.id, log);
      
      // MOBILE APP CONTRACT: success=true, status='paid', paid_at required
      return jsonResponse({
        success: true,
        status: 'paid',
        payment_status: 'paid',
        order_id: order.id,
        paid_at: order.payment_verified_at || order.updated_at || new Date().toISOString(),
      });
    }

    // ==================== CHECK UNIFIED PAYMENTS TABLE ====================
    
    const unifiedPayment = await getPaymentByOrderId(supabase, order.id);
    
    if (unifiedPayment) {
      log.log('[PAYMENT_VERIFY] Found payment record', { 
        paymentId: unifiedPayment.id,
        provider: unifiedPayment.provider_key,
        status: unifiedPayment.status,
      });

      // ==================== PAWAPAY VERIFICATION ====================
      if (unifiedPayment.provider_key === 'pawapay') {
        log.log('[PAYMENT_VERIFY] Using pawaPay verification', { paymentId: unifiedPayment.id });
        
        // Check if already completed in DB
        if (unifiedPayment.status === 'succeeded') {
          await markOrderPaidAndNotify(supabase, order, unifiedPayment, log);
          
          return jsonResponse({
            success: true,
            status: 'paid',
            payment_status: 'paid',
            order_id: order.id,
            paid_at: unifiedPayment.paid_at || new Date().toISOString(),
          });
        }
        
        // Verify with pawaPay API if deposit ID exists (PROVIDER FALLBACK)
        if (unifiedPayment.provider_deposit_id) {
          try {
            const provider = await getProviderByKey(supabase, 'pawapay');
            if (provider) {
              const pawaConfig = getPawaPayConfig(provider);
              const verifyResult = await verifyDeposit(pawaConfig, unifiedPayment.provider_deposit_id);
              
              log.log('[PAYMENT_VERIFY] pawaPay API verify result', { 
                depositId: unifiedPayment.provider_deposit_id,
                status: verifyResult.status,
                success: verifyResult.success,
                decision: verifyResult.status,
              });
              
              if (verifyResult.status === 'succeeded') {
                // Update payment and order status (CANONICAL FIELDS)
                const paidAt = verifyResult.paid_at || new Date().toISOString();
                await updatePaymentStatus(supabase, unifiedPayment.id, 'succeeded', {
                  provider_transaction_id: verifyResult.provider_transaction_id,
                  paid_at: paidAt,
                });
                
                await markOrderPaidAndNotify(supabase, order, unifiedPayment, log);
                
                log.log('[PAYMENT_VERIFY] Payment confirmed via provider fallback', {
                  orderId: order.id,
                  db_status: unifiedPayment.status,
                  provider_status: 'succeeded',
                  decision: 'PAID',
                });
                
                return jsonResponse({
                  success: true,
                  status: 'paid',
                  payment_status: 'paid',
                  order_id: order.id,
                  paid_at: paidAt,
                });
              }
              
              if (verifyResult.status === 'failed') {
                await updatePaymentStatus(supabase, unifiedPayment.id, 'failed');
                
                log.log('[PAYMENT_VERIFY] Payment failed via provider', {
                  orderId: order.id,
                  provider_status: 'failed',
                  decision: 'FAILED',
                });
                
                return jsonResponse({
                  success: false,
                  status: 'failed',
                  payment_status: 'failed',
                  order_id: order.id,
                  error: verifyResult.error || 'Payment failed',
                  error_code: 'PAYMENT_FAILED',
                });
              }
              
              // Still pending
              log.log('[PAYMENT_VERIFY] Payment still pending', {
                orderId: order.id,
                db_status: unifiedPayment.status,
                provider_status: 'pending',
              });
              
              return jsonResponse({
                success: true,
                status: 'pending',
                payment_status: 'pending',
              });
            }
          } catch (pawaError: any) {
            log.error('[PAYMENT_VERIFY] pawaPay verify error', { error: pawaError.message });
            // Fall through to return pending status
          }
        }
        
        // Return current status from DB - map to mobile-expected values
        const dbStatus = unifiedPayment.status?.toLowerCase() || 'pending';
        let frontendStatus: 'paid' | 'failed' | 'pending' = 'pending';
        
        if (dbStatus === 'succeeded' || dbStatus === 'completed' || dbStatus === 'paid') {
          frontendStatus = 'paid';
        } else if (dbStatus === 'failed' || dbStatus === 'cancelled' || dbStatus === 'expired') {
          frontendStatus = 'failed';
        }
        
        if (frontendStatus === 'paid') {
          return jsonResponse({
            success: true,
            status: 'paid',
            payment_status: 'paid',
            order_id: order.id,
            paid_at: unifiedPayment.paid_at || new Date().toISOString(),
          });
        }
        
        if (frontendStatus === 'failed') {
          return jsonResponse({
            success: false,
            status: 'failed',
            payment_status: 'failed',
            order_id: order.id,
            error: 'Payment failed',
            error_code: 'PAYMENT_FAILED',
          });
        }
        
        return jsonResponse({
          success: true,
          status: 'pending',
          payment_status: 'pending',
        });
      }

      // ==================== STRIPE VERIFICATION ====================
      if (unifiedPayment.provider_key === 'stripe' || unifiedPayment.provider_key === 'stripe_checkout') {
        log.log('[PAYMENT_VERIFY] Using Stripe verification', { 
          paymentId: unifiedPayment.id,
          providerKey: unifiedPayment.provider_key,
          depositId: unifiedPayment.provider_deposit_id,
        });
        
        // Check if already completed in DB
        if (unifiedPayment.status === 'succeeded') {
          await markOrderPaidAndNotify(supabase, order, unifiedPayment, log);
          
          return jsonResponse({
            success: true,
            status: 'paid',
            payment_status: 'paid',
            order_id: order.id,
            paid_at: unifiedPayment.paid_at || new Date().toISOString(),
          });
        }
        
        // PROVIDER FALLBACK: Verify with Stripe API
        if (unifiedPayment.provider_deposit_id) {
          try {
            const provider = await getProviderByKey(supabase, 'stripe');
            if (provider) {
              const stripeConfig = getStripeConfig(provider);
              
              // Use correct verification method based on provider type
              // stripe_checkout uses Checkout Sessions (cs_* IDs)
              // stripe uses PaymentIntents (pi_* IDs)
              let verifyResult;
              const depositId = unifiedPayment.provider_deposit_id;
              
              if (unifiedPayment.provider_key === 'stripe_checkout' || depositId.startsWith('cs_')) {
                log.log('[PAYMENT_VERIFY] Using Checkout Session verification', { depositId });
                verifyResult = await verifyCheckoutSession(stripeConfig, depositId);
              } else {
                log.log('[PAYMENT_VERIFY] Using PaymentIntent verification', { depositId });
                verifyResult = await verifyPaymentIntent(stripeConfig, depositId);
              }
              
              log.log('[PAYMENT_VERIFY] Stripe API verify result', { 
                depositId,
                status: verifyResult.status,
                success: verifyResult.success,
              });
              
              if (verifyResult.status === 'succeeded') {
                const paidAt = verifyResult.paid_at || new Date().toISOString();
                
                // Update payment and order status
                await updatePaymentStatus(supabase, unifiedPayment.id, 'succeeded', {
                  provider_transaction_id: verifyResult.provider_transaction_id,
                  paid_at: paidAt,
                });
                
                await markOrderPaidAndNotify(supabase, order, unifiedPayment, log);
                
                log.log('[PAYMENT_VERIFY] Stripe payment confirmed - returning success', {
                  orderId: order.id,
                  paidAt,
                });
                
                return jsonResponse({
                  success: true,
                  status: 'paid',
                  payment_status: 'paid',
                  order_id: order.id,
                  paid_at: paidAt,
                });
              }
              
              if (verifyResult.status === 'failed') {
                await updatePaymentStatus(supabase, unifiedPayment.id, 'failed');
                
                return jsonResponse({
                  success: false,
                  status: 'failed',
                  payment_status: 'failed',
                  order_id: order.id,
                  error: verifyResult.error || 'Payment failed',
                  error_code: 'PAYMENT_FAILED',
                });
              }
            }
          } catch (stripeError: any) {
            log.error('[PAYMENT_VERIFY] Stripe verify error', { error: stripeError.message });
            // Fall through to return DB status
          }
        }
        
        // Return current DB status - map to mobile-expected values
        const dbStatus = unifiedPayment.status?.toLowerCase() || 'pending';
        
        if (dbStatus === 'succeeded') {
          return jsonResponse({
            success: true,
            status: 'paid',
            payment_status: 'paid',
            order_id: order.id,
            paid_at: unifiedPayment.paid_at || new Date().toISOString(),
          });
        }
        
        if (dbStatus === 'failed') {
          return jsonResponse({
            success: false,
            status: 'failed',
            payment_status: 'failed',
            order_id: order.id,
            error: 'Payment failed',
            error_code: 'PAYMENT_FAILED',
          });
        }
        
        return jsonResponse({
          success: true,
          status: 'pending',
          payment_status: 'pending',
        });
      }

      // ==================== OTHER PROVIDERS ====================
      const dbStatus = unifiedPayment.status?.toLowerCase() || 'pending';
      
      if (dbStatus === 'succeeded' || dbStatus === 'completed' || dbStatus === 'paid') {
        return jsonResponse({
          success: true,
          status: 'paid',
          payment_status: 'paid',
          order_id: order.id,
          paid_at: unifiedPayment.paid_at || new Date().toISOString(),
        });
      }
      
      if (dbStatus === 'failed' || dbStatus === 'cancelled' || dbStatus === 'expired') {
        return jsonResponse({
          success: false,
          status: 'failed',
          payment_status: 'failed',
          order_id: order.id,
          error: 'Payment failed',
          error_code: 'PAYMENT_FAILED',
        });
      }
      
      return jsonResponse({
        success: true,
        status: 'pending',
        payment_status: 'pending',
      });
    }

    // ==================== NO PAYMENT RECORD FOUND ====================
    
    log.log('[PAYMENT_VERIFY] No payment record found, checking order status', { orderId: order.id });
    
    // Check order status directly
    if (order.status === 'PENDING_PAYMENT') {
      return jsonResponse({
        success: true,
        status: 'pending',
        payment_status: 'pending',
      });
    }
    
    if (order.status === 'CANCELLED' || order.status === 'REJECTED') {
      return jsonResponse({
        success: false,
        status: 'failed',
        payment_status: 'failed',
        order_id: order.id,
        error: 'Order was cancelled',
        error_code: 'ORDER_CANCELLED',
      });
    }

    // Default to pending
    return jsonResponse({
      success: true,
      status: 'pending',
      payment_status: 'pending',
    });

  } catch (error: any) {
    log.error('[PAYMENT_VERIFY] Error', { message: error.message });
    
    if (error.name === 'AuthError') {
      return jsonResponse({ 
        success: false,
        status: 'failed',
        payment_status: 'failed',
        error: error.message,
        error_code: 'AUTH_ERROR',
      }, error.status);
    }
    
    return jsonResponse({ 
      success: false,
      status: 'failed',
      payment_status: 'failed',
      error: 'An unexpected error occurred',
      error_code: 'INTERNAL_ERROR',
    }, 500);
  }
});

/**
 * Mark order as PAID, update payments table, checkout session, clear cart, and send email
 * 
 * CANONICAL FIELDS (must be updated together):
 * - orders.status = 'PAID'
 * - orders.payment_verified_at = now()
 * - payments.status = 'succeeded'
 * - payments.paid_at = now()
 */
async function markOrderPaidAndNotify(
  supabase: any, 
  order: any, 
  payment: any,
  log: any
): Promise<void> {
  const now = new Date().toISOString();
  
  // Update order status to PAID (canonical)
  const { error: orderError } = await supabase.from('orders').update({
    status: 'PAID',
    payment_verified_at: now,
    updated_at: now,
  }).eq('id', order.id);
  
  if (orderError) {
    log.error('[PAYMENT_VERIFY] Failed to update order status', { 
      orderId: order.id, 
      error: orderError.message 
    });
  } else {
    log.log('[PAYMENT_VERIFY] Order marked as PAID', { orderId: order.id });
  }
  
  // Update payment status to succeeded (canonical)
  if (payment?.id) {
    const { error: paymentError } = await supabase.from('payments').update({
      status: 'succeeded',
      paid_at: now,
      updated_at: now,
    }).eq('id', payment.id);
    
    if (paymentError) {
      log.error('[PAYMENT_VERIFY] Failed to update payment status', { 
        paymentId: payment.id, 
        error: paymentError.message 
      });
    } else {
      log.log('[PAYMENT_VERIFY] Payment marked as succeeded', { paymentId: payment.id });
    }
  }
  
  // Fetch and update checkout_session
  const { data: checkoutSession } = await supabase
    .from('checkout_sessions')
    .select('id, metadata')
    .eq('order_id', order.id)
    .maybeSingle();
  
  if (checkoutSession?.id) {
    await supabase.from('checkout_sessions').update({
      status: 'paid',
      paid_at: now,
    }).eq('id', checkoutSession.id);
    
    // Clear original cart items
    const metadata = checkoutSession.metadata as any;
    const originalCartItemIds = metadata?.original_cart_item_ids || metadata?.cart_item_ids;
    
    if (originalCartItemIds && Array.isArray(originalCartItemIds) && originalCartItemIds.length > 0) {
      log.log('[PAYMENT_VERIFY] Deleting original cart items', {
        count: originalCartItemIds.length,
      });
      
      await supabase.from('order_items').delete().in('id', originalCartItemIds);
    }
  }
  
  // Send payment confirmation email (idempotent)
  await sendPaymentConfirmationEmailIfNeeded(supabase, order.id, log);

  // Referral commission (fire-and-forget)
  const { data: paidOrderData } = await supabase.from('orders').select('user_id, total_amount').eq('id', order.id).maybeSingle();
  if (paidOrderData?.user_id) {
    createReferralCommission(supabase, order.id, paidOrderData.user_id, paidOrderData.total_amount || 0, 'mobile-verify-payment').catch(() => {});
  }
}

/**
 * Send payment confirmation email if not already sent (idempotent)
 * Uses payment_confirmation_email_sent_at as the idempotency flag
 */
async function sendPaymentConfirmationEmailIfNeeded(
  supabase: any,
  orderId: string,
  log: any
): Promise<void> {
  try {
    // Check if email already sent
    const { data: orderCheck } = await supabase
      .from('orders')
      .select('payment_confirmation_email_sent_at')
      .eq('id', orderId)
      .single();
    
    if (orderCheck?.payment_confirmation_email_sent_at) {
      log.log('[PAYMENT_EMAIL] Email already sent, skipping', { orderId });
      return;
    }
    
    // Mark as sent first (optimistic lock) - only update if still null
    const { data: updateResult, error: updateError } = await supabase
      .from('orders')
      .update({ payment_confirmation_email_sent_at: new Date().toISOString() })
      .eq('id', orderId)
      .is('payment_confirmation_email_sent_at', null)
      .select('id');
    
    // If no rows updated, another process already claimed it
    if (!updateResult || updateResult.length === 0) {
      log.log('[PAYMENT_EMAIL] Another process claimed email send', { orderId });
      return;
    }
    
    if (updateError) {
      log.warn('[PAYMENT_EMAIL] Failed to mark email as sent', { orderId, error: updateError.message });
      return;
    }
    
    // Send email via edge function (fire-and-forget)
    log.log('[PAYMENT_EMAIL] Sending confirmation email', { orderId });
    
    supabase.functions.invoke('send-payment-confirmation', {
      body: { orderId },
    }).then((result: any) => {
      if (result.error) {
        log.error('[PAYMENT_EMAIL] Send failed', { orderId, error: result.error.message });
      } else {
        log.log('[PAYMENT_EMAIL] Sent successfully', { orderId });
      }
    }).catch((err: any) => {
      log.error('[PAYMENT_EMAIL] Invoke error', { orderId, error: err.message });
    });
    
  } catch (error: any) {
    log.error('[PAYMENT_EMAIL] Error', { orderId, error: error.message });
  }
}
