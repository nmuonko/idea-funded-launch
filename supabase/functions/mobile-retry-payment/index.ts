import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";
import {
  createPaymentSession,
  getMaishaPayConfig,
  validateConfig,
} from "../_shared/maishapay.ts";
import { 
  getActiveProvider, 
  createPaymentRecord,
  generatePaymentReference,
  validateProviderSecrets,
} from "../_shared/paymentProviders.ts";
import { createDeposit, getPawaPayConfig } from "../_shared/pawapayAdapter.ts";

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const { user, supabase } = await verifyAndGetUser(req);
    console.log('[mobile-retry-payment] User authenticated:', user.id);

    const body = await req.json();
    const { order_id, payment_method, country } = body;

    if (!order_id) {
      return errorResponse('order_id is required', 400);
    }

    // Get order and validate ownership
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', order_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (orderError) {
      console.error('[mobile-retry-payment] DB error:', orderError);
      return jsonResponse({ error: 'DB_ERROR', message: 'Failed to fetch order' }, 500);
    }

    if (!order) {
      return jsonResponse({ error: 'ORDER_NOT_FOUND', message: 'Order not found' }, 404);
    }

    // Check if order can be retried
    const canRetry = (
      order.status === 'PENDING_PAYMENT' ||
      order.maisha_payment_status === 'FAILED' ||
      order.maisha_payment_status === 'CANCELLED' ||
      order.maisha_payment_status === 'INIT_FAILED'
    );

    if (!canRetry) {
      return jsonResponse({ 
        error: 'CANNOT_RETRY', 
        message: `Order cannot be retried. Current status: ${order.status}` 
      }, 400);
    }

    // Already paid?
    if (order.status === 'PAID' || order.maisha_payment_status === 'SUCCESS') {
      return jsonResponse({ 
        error: 'ALREADY_PAID', 
        message: 'Order is already paid' 
      }, 400);
    }

    // Get user profile for customer details
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, name, phone')
      .eq('user_id', user.id)
      .maybeSingle();

    const customerEmail = user.email || '';
    const customerPhone = profile?.phone || '';
    const customerName = profile?.full_name || profile?.name || '';

    // Determine the active payment provider
    const provider = await getActiveProvider(supabase, country || 'COD', payment_method || 'MOBILE_MONEY');
    
    console.log('[mobile-retry-payment] Active provider:', provider?.provider_key || 'none');

    // ==================== PAWAPAY ROUTING ====================
    
    if (provider && provider.provider_key === 'pawapay' && provider.is_enabled) {
      console.log('[mobile-retry-payment] Routing retry to pawaPay');
      
      const secretsValid = validateProviderSecrets(provider);
      if (!secretsValid.valid) {
        console.error('[mobile-retry-payment] pawaPay secrets missing:', secretsValid.missing);
        // Fall through to MaishaPay
      } else {
        try {
          const pawaConfig = getPawaPayConfig(provider);
          const reference = generatePaymentReference(order_id);
          
          const depositResult = await createDeposit(pawaConfig, {
            orderId: order_id,
            amount: order.total_usd,
            currency: 'USD',
            customerPhone,
            customerEmail,
            country: country || 'COD',
            reference,
            description: `AfriShop Order #${order_id.slice(0, 8)} (Retry)`,
          });

          if (depositResult.success) {
            // Create payment record in unified payments table
            await createPaymentRecord(supabase, {
              order_id,
              provider_key: 'pawapay',
              amount: order.total_usd,
              currency: 'USD',
              reference,
              customer_phone: customerPhone,
              country: country || 'COD',
              provider_deposit_id: depositResult.provider_deposit_id,
              raw_request: { ...depositResult.raw_request, retry: true },
              status: 'pending',
            });

            // Update order status
            await supabase.from('orders').update({
              status: 'PENDING_PAYMENT',
              maisha_payment_status: 'PENDING',
              updated_at: new Date().toISOString(),
            }).eq('id', order_id);

            console.log('[mobile-retry-payment] pawaPay retry SUCCESS:', {
              orderId: order_id,
              depositId: depositResult.provider_deposit_id,
            });

            return jsonResponse({
              success: true,
              order_id,
              provider: 'pawapay',
              payment_flow: 'USSD_PUSH',
              message: depositResult.message || 'Payment request sent to your phone',
              is_retry: true,
              order: {
                id: order_id,
                status: 'PENDING_PAYMENT',
                totalUsd: order.total_usd,
                totalCdf: order.total_cdf,
              },
            });
          } else {
            console.warn('[mobile-retry-payment] pawaPay deposit failed, falling back to MaishaPay:', depositResult.error);
          }
        } catch (pawaError: any) {
          console.error('[mobile-retry-payment] pawaPay error, falling back to MaishaPay:', pawaError.message);
        }
      }
    }

    // ==================== MAISHAPAY FALLBACK ====================

    // Validate MaishaPay configuration
    const maishaConfig = getMaishaPayConfig();
    const configValidation = validateConfig(maishaConfig);
    if (!configValidation.valid) {
      console.error('[mobile-retry-payment] Config error:', configValidation.error);
      return jsonResponse({ 
        error: 'PAYMENT_CONFIG_ERROR', 
        message: 'Payment gateway not configured' 
      }, 500);
    }

    // Create new payment session with retry suffix
    const retryOrderId = `${order_id}-R${Date.now().toString(36)}`;
    
    const paymentResult = await createPaymentSession({
      amountUsd: order.total_usd,
      currency: 'USD',
      customerEmail,
      customerPhone,
      customerName,
      orderId: retryOrderId,
      description: `AfriShop Order #${order_id.slice(0, 8)} (Retry)`,
    });

    if (!paymentResult.success) {
      console.error('[mobile-retry-payment] MaishaPay error:', paymentResult.error);
      return jsonResponse({ 
        error: 'PAYMENT_INIT_FAILED', 
        message: 'Failed to initialize payment' 
      }, 500);
    }

    // Create new payment record
    const { error: paymentRecordError } = await supabase
      .from('maisha_payments')
      .insert({
        order_id: order_id,
        maisha_reference: paymentResult.reference,
        amount_usd: order.total_usd,
        amount_cdf: order.total_cdf,
        currency: 'USD',
        status: 'pending',
        raw_request: {
          retry: true,
          amount: order.total_usd,
          email: customerEmail,
          phone: customerPhone,
          mode: maishaConfig.mode,
          original_reference: order.maisha_transaction_id,
        },
      });

    if (paymentRecordError) {
      console.error('[mobile-retry-payment] Payment record error:', paymentRecordError);
    }

    // Update order with new reference
    await supabase.from('orders').update({
      maisha_transaction_id: paymentResult.reference,
      maisha_payment_status: 'PENDING',
      status: 'PENDING_PAYMENT',
      updated_at: new Date().toISOString(),
    }).eq('id', order_id);

    console.log('[mobile-retry-payment] MaishaPay retry created:', {
      orderId: order_id,
      reference: paymentResult.reference,
      mode: maishaConfig.mode,
    });

    // Get checkout form fields
    const formFields = {
      publicApiKey: maishaConfig.publicKey,
      gatewayMode: maishaConfig.mode === 'live' ? '1' : '0',
      montant: order.total_usd.toString(),
      devise: 'USD',
      callbackUrl: maishaConfig.callbackUrl,
      reference: paymentResult.reference,
      email_client: customerEmail,
      nom_client: customerName,
      telephone_client: customerPhone,
    };

    return jsonResponse({
      success: true,
      order_id: order_id,
      maishapay_transaction_id: paymentResult.reference,
      maishapay_reference: paymentResult.reference,
      payment_url: paymentResult.checkoutUrl,
      provider: 'maishapay',
      payment_flow: 'HTML_CHECKOUT',
      payment_mode: maishaConfig.mode,
      checkout_fields: formFields,
      is_retry: true,
      order: {
        id: order_id,
        status: 'PENDING_PAYMENT',
        totalUsd: order.total_usd,
        totalCdf: order.total_cdf,
      },
      message: `Retry payment created (${maishaConfig.mode} mode). Open payment_url in WebView.`,
    });

  } catch (error: any) {
    console.error('[mobile-retry-payment] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return errorResponse(error.message, error.status);
    }
    
    return jsonResponse({ 
      error: 'INTERNAL_ERROR', 
      message: error.message 
    }, 500);
  }
});
