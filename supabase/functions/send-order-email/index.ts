import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OrderEmailRequest {
  orderId: string;
  templateType: 'order_confirmed' | 'payment_verified' | 'order_shipped' | 'order_delivered' | 'custom';
  customSubject?: string;
  customMessage?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { orderId, templateType, customSubject, customMessage }: OrderEmailRequest = await req.json();

    // Fetch order details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        *,
        profiles!inner(name, email),
        order_items(title, quantity, total_price_usd)
      `)
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const customerEmail = order.profiles.email;
    const customerName = order.profiles.name || 'Customer';

    let subject = '';
    let html = '';

    switch (templateType) {
      case 'order_confirmed':
        subject = `Order Confirmation - #${orderId.slice(0, 8)}`;
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #1e40af;">Order Confirmed!</h1>
            <p>Hi ${customerName},</p>
            <p>Thank you for your order. We've received your order and will begin processing it soon.</p>
            
            <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h2 style="color: #374151; margin-top: 0;">Order Details</h2>
              <p><strong>Order ID:</strong> ${orderId.slice(0, 8)}...</p>
              <p><strong>Total:</strong> $${Number(order.total_usd || 0).toFixed(2)}</p>
              <p><strong>Items:</strong> ${order.order_items.length} item(s)</p>
            </div>

            <h3 style="color: #374151;">Items Ordered:</h3>
            <ul>
              ${order.order_items.map((item: any) => `
                <li>${item.title || 'Product'} - Qty: ${item.quantity} - $${Number(item.total_price_usd || 0).toFixed(2)}</li>
              `).join('')}
            </ul>

            <p style="color: #6b7280; margin-top: 30px;">
              We'll notify you when your order ships.
            </p>
            <p style="color: #6b7280;">
              Best regards,<br>
              AfriShop Team
            </p>
          </div>
        `;
        break;

      case 'payment_verified':
        subject = `Payment Verified - Order #${orderId.slice(0, 8)}`;
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #059669;">Payment Verified!</h1>
            <p>Hi ${customerName},</p>
            <p>Great news! We've verified your payment for order #${orderId.slice(0, 8)}.</p>
            
            <div style="background: #d1fae5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #059669;">
              <p style="margin: 0; color: #065f46;"><strong>✓ Payment Confirmed</strong></p>
              <p style="margin: 10px 0 0 0; color: #065f46;">Amount: $${Number(order.total_usd || 0).toFixed(2)}</p>
            </div>

            <p>Your order is now being prepared for shipment. We'll send you another update once it's on the way.</p>

            <p style="color: #6b7280; margin-top: 30px;">
              Best regards,<br>
              AfriShop Team
            </p>
          </div>
        `;
        break;

      case 'order_shipped':
        subject = `Your Order Has Shipped - #${orderId.slice(0, 8)}`;
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #7c3aed;">Order Shipped!</h1>
            <p>Hi ${customerName},</p>
            <p>Your order #${orderId.slice(0, 8)} is on its way!</p>
            
            <div style="background: #ede9fe; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #7c3aed;">
              ${order.tracking_number ? `
                <p style="margin: 0; color: #5b21b6;"><strong>Tracking Number:</strong> ${order.tracking_number}</p>
                <p style="margin: 10px 0 0 0; color: #5b21b6;"><strong>Carrier:</strong> ${order.carrier || 'N/A'}</p>
              ` : `
                <p style="margin: 0; color: #5b21b6;"><strong>Status:</strong> In Transit</p>
              `}
            </div>

            <p><strong>Shipping to:</strong> ${order.shipping_city || 'N/A'}</p>
            ${order.estimated_delivery ? `<p><strong>Estimated Delivery:</strong> ${new Date(order.estimated_delivery).toLocaleDateString()}</p>` : ''}

            <p style="color: #6b7280; margin-top: 30px;">
              We'll notify you when your order arrives.
            </p>
            <p style="color: #6b7280;">
              Best regards,<br>
              AfriShop Team
            </p>
          </div>
        `;
        break;

      case 'order_delivered':
        subject = `Order Delivered - #${orderId.slice(0, 8)}`;
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #059669;">Order Delivered!</h1>
            <p>Hi ${customerName},</p>
            <p>Great news! Your order #${orderId.slice(0, 8)} has been delivered.</p>
            
            <div style="background: #d1fae5; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #059669;">
              <p style="margin: 0; color: #065f46; font-size: 18px;"><strong>✓ Successfully Delivered</strong></p>
              <p style="margin: 10px 0 0 0; color: #065f46;">Delivered on: ${new Date().toLocaleDateString()}</p>
            </div>

            <p>We hope you enjoy your purchase! If you have any questions or concerns, please don't hesitate to reach out to our support team.</p>

            <p style="color: #6b7280; margin-top: 30px;">
              Thank you for shopping with us!<br>
              AfriShop Team
            </p>
          </div>
        `;
        break;

      case 'custom':
        subject = customSubject || `Order Update - #${orderId.slice(0, 8)}`;
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #1e40af;">Order Update</h1>
            <p>Hi ${customerName},</p>
            
            <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p style="white-space: pre-wrap;">${customMessage || 'We have an update regarding your order.'}</p>
            </div>

            <p><strong>Order ID:</strong> ${orderId.slice(0, 8)}</p>

            <p style="color: #6b7280; margin-top: 30px;">
              If you have any questions, please contact our support team.
            </p>
            <p style="color: #6b7280;">
              Best regards,<br>
              AfriShop Team
            </p>
          </div>
        `;
        break;

      default:
        return new Response(JSON.stringify({ error: 'Invalid template type' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }

    const emailFrom = Deno.env.get('EMAIL_FROM_ADDRESS') || 'AfriShop <onboarding@resend.dev>';
    const resendApiKey = Deno.env.get('RESEND_API_KEY');

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [customerEmail],
        subject,
        html,
      }),
    });

    if (!resendResponse.ok) {
      const errorData = await resendResponse.json();
      console.error('Resend API error:', errorData);
      return new Response(JSON.stringify({ error: errorData.message || 'Failed to send email' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const emailData = await resendResponse.json();
    console.log('Email sent successfully:', emailData);

    return new Response(JSON.stringify({ success: true, data: emailData }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error in send-order-email function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
