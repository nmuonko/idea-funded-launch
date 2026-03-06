import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { sendEmail, DEFAULT_FROM_EMAIL } from "../_shared/email.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { orderId, trackingNumber, carrier } = await req.json();

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Order ID required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[send-shipping-notification] Order:', orderId);

    // Get order details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, profiles(*)')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user email
    const { data: { user } } = await supabase.auth.admin.getUserById(order.user_id);
    const customerEmail = user?.email;

    if (!customerEmail) {
      return new Response(JSON.stringify({ error: 'Customer email not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const customerName = order.profiles?.full_name || order.profiles?.name || 'Customer';

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1e3a5f 0%, #10b981 100%); padding: 40px 20px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">📦 Your Order Has Shipped!</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Votre commande est en route!</p>
        </div>
        
        <div style="background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="font-size: 16px; margin-top: 0;">
            Hi ${customerName} / Bonjour ${customerName},
          </p>
          
          <p style="font-size: 16px;">
            Great news! Your order has been shipped and is on its way to you.
          </p>
          <p style="font-size: 14px; color: #6b7280;">
            Bonne nouvelle! Votre commande a été expédiée et est en route vers vous.
          </p>
          
          <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 24px 0;">
            <h2 style="margin: 0 0 12px 0; font-size: 18px; color: #10b981;">Shipping Details / Détails d'expédition</h2>
            <p style="margin: 4px 0; color: #6b7280;">
              <strong>Order ID:</strong> ${orderId.slice(0, 8)}...
            </p>
            ${trackingNumber ? `
              <p style="margin: 4px 0; color: #6b7280;">
                <strong>Tracking Number:</strong> <span style="font-family: monospace; background: #e5e7eb; padding: 2px 8px; border-radius: 4px;">${trackingNumber}</span>
              </p>
            ` : ''}
            ${carrier ? `
              <p style="margin: 4px 0; color: #6b7280;">
                <strong>Carrier:</strong> ${carrier}
              </p>
            ` : ''}
            <p style="margin: 4px 0; color: #6b7280;">
              <strong>Shipped Date:</strong> ${new Date().toLocaleDateString()}
            </p>
            ${order.estimated_delivery ? `
              <p style="margin: 4px 0; color: #6b7280;">
                <strong>Estimated Delivery:</strong> ${new Date(order.estimated_delivery).toLocaleDateString()}
              </p>
            ` : ''}
          </div>
          
          <p style="margin-top: 24px; color: #6b7280; font-size: 14px;">
            If you have any questions about your shipment, please contact our support team.<br>
            Si vous avez des questions, contactez notre équipe support.
          </p>
          
          <p style="margin-top: 32px; font-size: 16px;">
            Best regards / Cordialement,<br>
            <strong>The AfriShop USA Team</strong>
          </p>
        </div>
        
        <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop USA. All rights reserved.</p>
        </div>
      </body>
      </html>
    `;

    const result = await sendEmail({
      to: customerEmail,
      subject: '📦 Your Order Has Shipped / Votre commande est expédiée',
      html: emailHtml,
      category: "shipping_notification",
    });

    console.log('[send-shipping-notification] Result:', result);

    return new Response(JSON.stringify({ success: result.success, id: result.id }), {
      status: result.success ? 200 : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[send-shipping-notification] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
