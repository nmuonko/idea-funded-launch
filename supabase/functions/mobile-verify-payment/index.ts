import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse,
} from "../_shared/auth.ts";
import { verifyPaymentStatus, getMaishaPayConfig } from "../_shared/maishapay.ts";

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    console.log('[mobile-verify-payment] Request received');

    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-verify-payment] User authenticated:', user.id);

    const body = await req.json();
    const { order_id, maishapay_reference } = body;

    if (!order_id && !maishapay_reference) {
      return errorResponse('order_id or maishapay_reference is required', 400);
    }

    const config = getMaishaPayConfig();
    console.log('[mobile-verify-payment] Mode:', config.mode);

    // Find the order with item count
    let query = supabase.from('orders').select('*, order_items(id)');
    
    if (order_id) {
      query = query.eq('id', order_id);
    } else {
      query = query.eq('maisha_transaction_id', maishapay_reference);
    }

    const { data: order, error: orderError } = await query.eq('user_id', user.id).single();

    if (orderError || !order) {
      return jsonResponse({ error: 'ORDER_NOT_FOUND', message: 'Order not found' }, 404);
    }

    // Get confirmation code from maisha_payments
    const { data: payment } = await supabase
      .from('maisha_payments')
      .select('confirmation_code')
      .eq('order_id', order.id)
      .maybeSingle();

    // Generate short order reference (first 8 chars of UUID)
    const orderRef = order.id.substring(0, 8).toUpperCase();
    const itemCount = order.order_items?.length || 0;
    const confirmationCode = payment?.confirmation_code || null;

    // Build base response data
    const buildResponse = (status: string, paymentStatus: string, orderStatus: string, message: string) => ({
      success: true,
      orderId: order.id,
      orderRef,
      status,
      paymentStatus,
      orderStatus,
      totalUsd: order.total_usd || 0,
      totalCdf: order.total_cdf || 0,
      itemCount,
      confirmationCode,
      mode: config.mode,
      message,
    });

    // If already paid, return current status
    if (order.status === 'PAID' || order.maisha_payment_status === 'SUCCESS') {
      return jsonResponse(buildResponse('paid', 'SUCCESS', 'PAID', 'Paiement confirmé'));
    }

    // Verify with MaishaPay API
    const reference = order.maisha_transaction_id || `AFRISHOP-${order.id}`;
    const verifyResult = await verifyPaymentStatus(reference);

    console.log('[mobile-verify-payment] Verify result:', verifyResult);

    // Update order if status changed
    if (verifyResult.success && verifyResult.status === 'paid') {
      await supabase.from('orders').update({
        status: 'PAID',
        maisha_payment_status: 'SUCCESS',
        operator_ref_id: verifyResult.operatorRefId,
        updated_at: new Date().toISOString(),
      }).eq('id', order.id);

      // Update payment record
      await supabase.from('maisha_payments').update({
        status: 'paid',
        paid_at: new Date().toISOString(),
      }).eq('order_id', order.id);

      return jsonResponse(buildResponse('paid', 'SUCCESS', 'PAID', 'Paiement confirmé'));
    }

    return jsonResponse(buildResponse(
      verifyResult.status || 'pending',
      'PENDING',
      order.status,
      'Paiement en attente de confirmation'
    ));

  } catch (error: any) {
    console.error('[mobile-verify-payment] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return jsonResponse({ 
      error: 'INTERNAL_ERROR', 
      message: error.message 
    }, 500);
  }
});
