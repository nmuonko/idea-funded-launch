import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, DEFAULT_FROM_EMAIL } from "../_shared/email.ts";

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
    // Verify the caller is authenticated
    const authClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      console.error('[send-order-email] Unauthorized:', userError);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use service role client for fetching data (bypasses RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { orderId, templateType, customSubject, customMessage }: OrderEmailRequest = await req.json();

    console.log('[send-order-email] Processing request:', { orderId, templateType });

    // Fetch order details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, order_items(title, quantity, total_price_usd, unit_price_usd)')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('[send-order-email] Order not found:', { orderId, error: orderError });
      return new Response(JSON.stringify({ error: 'Order not found', orderId }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[send-order-email] Order found:', { orderId, user_id: order.user_id });

    // Explicitly fetch profile by user_id
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('user_id, full_name, name, email, phone')
      .eq('user_id', order.user_id)
      .maybeSingle();

    console.log('[send-order-email] Profile lookup:', { 
      user_id: order.user_id, 
      profile_found: !!profile, 
      profile_email: profile?.email,
      error: profileError?.message 
    });

    // Try to get email from profile, or fallback to auth.users
    let customerEmail = profile?.email;
    let customerName = profile?.full_name || profile?.name || 'Customer';

    // If no email in profile, try to get from auth.users
    if (!customerEmail) {
      console.log('[send-order-email] No email in profile, checking auth.users...');
      const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(order.user_id);
      
      if (!authError && authUser?.user?.email) {
        customerEmail = authUser.user.email;
        customerName = authUser.user.user_metadata?.full_name || customerName;
        console.log('[send-order-email] Found email in auth.users:', customerEmail);
      }
    }

    if (!customerEmail) {
      console.error('[send-order-email] No customer email found for order:', orderId);
      return new Response(JSON.stringify({ 
        error: 'Customer email not found. Please ensure the customer has an email address on their profile.',
        orderId,
        user_id: order.user_id
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[send-order-email] Sending email to:', customerEmail);

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
              <p><strong>Items:</strong> ${order.order_items?.length || 0} item(s)</p>
            </div>

            ${order.order_items?.length > 0 ? `
              <h3 style="color: #374151;">Items Ordered:</h3>
              <ul>
                ${order.order_items.map((item: any) => `
                  <li>${item.title || 'Product'} - Qty: ${item.quantity} - $${Number(item.total_price_usd || item.unit_price_usd || 0).toFixed(2)}</li>
                `).join('')}
              </ul>
            ` : ''}

            <p style="color: #6b7280; margin-top: 30px;">
              We'll notify you when your order ships.
            </p>
            <p style="color: #6b7280;">
              Best regards,<br>
              <strong>AfriShop USA Team</strong>
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
              <strong>AfriShop USA Team</strong>
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
              <strong>AfriShop USA Team</strong>
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
              <strong>AfriShop USA Team</strong>
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
              <strong>AfriShop USA Team</strong>
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

    // Send email using shared email utility
    const result = await sendEmail({
      to: customerEmail,
      subject,
      html,
      category: templateType === 'order_confirmed' ? 'order_confirmation' 
        : templateType === 'payment_verified' ? 'payment_success'
        : templateType === 'order_shipped' ? 'order_shipped'
        : templateType === 'order_delivered' ? 'order_delivered'
        : 'order_status_update',
    });

    if (!result.success) {
      console.error('[send-order-email] Failed to send email:', result.error);
      return new Response(JSON.stringify({ error: result.error || 'Failed to send email' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[send-order-email] Email sent successfully:', result.id);

    return new Response(JSON.stringify({ success: true, data: { id: result.id } }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[send-order-email] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
