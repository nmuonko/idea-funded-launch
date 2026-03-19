import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { 
  verifyAndGetUser, 
  handleCors, 
  errorResponse, 
  jsonResponse 
} from "../_shared/auth.ts";
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
      order.status === 'CANCELLED'
    );

    if (!canRetry) {
      return jsonResponse({ 
        error: 'CANNOT_RETRY', 
        message: `Order cannot be retried. Current status: ${order.status}` 
      }, 400);
    }

    // Already paid?
    if (order.status === 'PAID') {
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
        return jsonResponse({ 
          error: 'PROVIDER_CONFIG_ERROR', 
          message: 'Payment provider is not properly configured. Please contact support.' 
        }, 500);
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

            await supabase.from('orders').update({
              status: 'PENDING_PAYMENT',
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
            console.warn('[mobile-retry-payment] pawaPay deposit failed:', depositResult.error);
            return jsonResponse({ 
              error: 'PAYMENT_INIT_FAILED',
              message: depositResult.error || 'Failed to initialize payment. Please try again.' 
            }, 500);
          }
        } catch (pawaError: any) {
          console.error('[mobile-retry-payment] pawaPay error:', pawaError.message);
          return jsonResponse({ 
            error: 'PAYMENT_ERROR', 
            message: 'Payment processing error. Please try again.' 
          }, 500);
        }
      }
    }

    // No valid provider available
    console.error('[mobile-retry-payment] No payment provider available');
    return jsonResponse({ 
      error: 'NO_PROVIDER_AVAILABLE', 
      message: 'No payment provider is currently available. Please contact support.' 
    }, 500);

  } catch (error: any) {
    console.error('[mobile-retry-payment] Error:', error.message);
    
    if (error.name === 'AuthError') {
      return jsonResponse({
        ok: false,
        success: false,
        authenticated: false,
        error: 'AUTH_ERROR',
        message: 'Authentication failed. Please sign in again.',
      }, 200);
    }
    
    return jsonResponse({ 
      error: 'INTERNAL_ERROR', 
      message: error.message 
    }, 500);
  }
});
