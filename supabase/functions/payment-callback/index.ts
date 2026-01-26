// payment-callback/index.ts
// Handles Stripe Checkout redirect for mobile apps (Safari ViewController)
// Verifies payment with Stripe, updates database, and redirects to app deep link

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('session_id');
  const cancelled = url.searchParams.get('cancelled');
  const orderIdParam = url.searchParams.get('order_id') || '';

  console.log('[payment-callback] Request received', {
    sessionId: sessionId ? `${sessionId.substring(0, 20)}...` : null,
    cancelled,
    orderIdParam: orderIdParam || 'none'
  });

  // If cancelled, redirect to app with cancel status
  if (cancelled === 'true') {
    console.log('[payment-callback] User cancelled payment');
    return returnAppRedirect('cancelled', orderIdParam);
  }

  // No session_id = invalid request
  if (!sessionId) {
    console.error('[payment-callback] Missing session_id');
    return returnAppRedirect('error', orderIdParam, 'Missing session ID');
  }

  // Verify with Stripe
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeSecretKey) {
    console.error('[payment-callback] STRIPE_SECRET_KEY not configured');
    return returnAppRedirect('error', orderIdParam, 'Payment service unavailable');
  }

  try {
    const stripeResponse = await fetch(
      `${STRIPE_API_BASE}/checkout/sessions/${sessionId}`,
      {
        headers: {
          'Authorization': `Bearer ${stripeSecretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    if (!stripeResponse.ok) {
      const errorText = await stripeResponse.text();
      console.error('[payment-callback] Stripe API error', { status: stripeResponse.status, error: errorText });
      return returnAppRedirect('error', orderIdParam, 'Failed to verify payment');
    }

    const session = await stripeResponse.json();
    const orderId = session.metadata?.order_id || orderIdParam;

    console.log('[payment-callback] Stripe session retrieved', {
      sessionId: session.id,
      paymentStatus: session.payment_status,
      orderId,
      amountTotal: session.amount_total,
      currency: session.currency
    });

    // If paid, update database
    if (session.payment_status === 'paid') {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

      if (!supabaseUrl || !supabaseServiceKey) {
        console.error('[payment-callback] Supabase credentials missing');
        // Still redirect to success since payment IS confirmed
        return returnAppRedirect('success', orderId);
      }

      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const now = new Date().toISOString();

      // Update orders table
      const { error: orderError } = await supabase
        .from('orders')
        .update({
          status: 'PAID',
          payment_verified_at: now,
          updated_at: now
        })
        .eq('id', orderId);

      if (orderError) {
        console.error('[payment-callback] Failed to update order', { orderId, error: orderError });
      } else {
        console.log('[payment-callback] Order updated to PAID', { orderId });
      }

      // Update payments table - try both provider_deposit_id and provider_transaction_id
      const { error: paymentError } = await supabase
        .from('payments')
        .update({
          status: 'succeeded',
          paid_at: now,
          updated_at: now
        })
        .eq('order_id', orderId);

      if (paymentError) {
        console.error('[payment-callback] Failed to update payment', { orderId, error: paymentError });
      } else {
        console.log('[payment-callback] Payment updated to succeeded', { orderId });
      }

      // Update checkout_sessions if exists
      await supabase
        .from('checkout_sessions')
        .update({
          status: 'paid',
          paid_at: now,
          updated_at: now
        })
        .eq('order_id', orderId);

      console.log('[payment-callback] Redirecting to app with success', { orderId });
      return returnAppRedirect('success', orderId);
    }

    // Payment not complete yet (unpaid or requires action)
    console.log('[payment-callback] Payment not complete', { paymentStatus: session.payment_status });
    return returnAppRedirect('pending', orderId);

  } catch (error) {
    console.error('[payment-callback] Unexpected error', { error: String(error) });
    return returnAppRedirect('error', orderIdParam, 'Verification failed');
  }
});

function returnAppRedirect(
  status: 'success' | 'cancelled' | 'pending' | 'error',
  orderId: string,
  errorMessage?: string
): Response {
  const deepLink = `afrishop://payment-complete?status=${status}&order_id=${orderId}${errorMessage ? `&error=${encodeURIComponent(errorMessage)}` : ''}`;

  // Fallback web URL for if deep link fails
  const webFallback = status === 'success'
    ? `https://afrishop-usa.com/payment-success?orderId=${orderId}`
    : status === 'cancelled'
    ? `https://afrishop-usa.com/payment-fail?orderId=${orderId}&cancelled=true`
    : `https://afrishop-usa.com/payment-fail?orderId=${orderId}`;

  const statusConfig = {
    success: { emoji: '✓', title: 'Payment Successful', message: 'Your payment has been confirmed.', color: '#22c55e' },
    cancelled: { emoji: '✕', title: 'Payment Cancelled', message: 'Your payment was cancelled.', color: '#f59e0b' },
    pending: { emoji: '⏳', title: 'Processing...', message: 'Your payment is being processed.', color: '#3b82f6' },
    error: { emoji: '⚠', title: 'Payment Error', message: errorMessage || 'Something went wrong.', color: '#ef4444' }
  };

  const config = statusConfig[status];

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${config.title} - AfriShop</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
      text-align: center; 
      padding: 40px 20px; 
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container { 
      max-width: 380px; 
      width: 100%;
      background: rgba(255,255,255,0.95); 
      padding: 40px 30px; 
      border-radius: 20px; 
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
    }
    .icon {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: ${config.color};
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
      font-size: 40px;
      color: white;
    }
    h1 { 
      color: #1a1a2e; 
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 12px;
    }
    p { 
      color: #666; 
      font-size: 16px;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .spinner { 
      border: 3px solid #e5e5e5; 
      border-top: 3px solid ${config.color}; 
      border-radius: 50%; 
      width: 32px; 
      height: 32px; 
      animation: spin 1s linear infinite; 
      margin: 20px auto;
    }
    @keyframes spin { 
      0% { transform: rotate(0deg); } 
      100% { transform: rotate(360deg); } 
    }
    .redirect-text {
      color: #999;
      font-size: 14px;
      margin-bottom: 20px;
    }
    .btn {
      display: inline-block;
      padding: 14px 32px;
      background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
      color: white;
      text-decoration: none;
      border-radius: 12px;
      font-weight: 600;
      font-size: 16px;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px rgba(59, 130, 246, 0.4);
    }
    .web-link {
      display: block;
      margin-top: 16px;
      color: #3b82f6;
      font-size: 14px;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">${config.emoji}</div>
    <h1>${config.title}</h1>
    <p>${config.message}</p>
    <div class="spinner"></div>
    <p class="redirect-text">Returning to AfriShop...</p>
    <a href="${deepLink}" class="btn">Open AfriShop App</a>
    <a href="${webFallback}" class="web-link">Continue on web →</a>
  </div>
  <script>
    // Try to open app immediately
    var deepLink = "${deepLink}";
    var webFallback = "${webFallback}";
    
    // Attempt deep link after short delay
    setTimeout(function() {
      window.location.href = deepLink;
    }, 1500);
    
    // Fallback to web if app doesn't open
    setTimeout(function() {
      // If we're still here after 3s, the app didn't open
      // User can click the button manually
    }, 3000);
  </script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}
