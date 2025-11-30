import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@4.0.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
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

    console.log('[Shipping Notification] Order:', orderId);

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

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 20px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">📦 Your Order Has Shipped!</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Track your package</p>
        </div>
        
        <div style="background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="font-size: 16px; margin-top: 0;">
            Hi ${order.profiles?.full_name || order.profiles?.name || 'Customer'},
          </p>
          
          <p style="font-size: 16px;">
            Great news! Your order has been shipped and is on its way to you.
          </p>
          
          <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 24px 0;">
            <h2 style="margin: 0 0 12px 0; font-size: 18px; color: #10b981;">Shipping Details</h2>
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
          
          <div style="background: #ecfdf5; border-left: 4px solid #10b981; padding: 16px; border-radius: 4px; margin: 24px 0;">
            <p style="margin: 0; color: #065f46; font-weight: 600;">Track Your Package</p>
            <p style="margin: 8px 0 0 0; color: #065f46;">
              ${trackingNumber 
                ? 'Use the tracking number above to monitor your shipment\'s progress with the carrier.' 
                : 'You\'ll receive tracking information soon.'}
            </p>
          </div>
          
          <p style="margin-top: 24px; color: #6b7280; font-size: 14px;">
            If you have any questions about your shipment, please contact our support team.
          </p>
          
          <p style="margin-top: 32px; font-size: 16px;">
            Best regards,<br>
            <strong>The AfriShop Team</strong>
          </p>
        </div>
        
        <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop. All rights reserved.</p>
        </div>
      </body>
      </html>
    `;

    const emailResponse = await resend.emails.send({
      from: Deno.env.get('EMAIL_FROM_ADDRESS') || 'AfriShop <onboarding@resend.dev>',
      to: [customerEmail],
      subject: '📦 Your Order Has Shipped',
      html: emailHtml,
    });

    console.log('[Shipping Notification] Sent:', emailResponse);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[Shipping Notification] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
