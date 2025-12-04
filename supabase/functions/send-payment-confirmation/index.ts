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

    const { orderId } = await req.json();

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Order ID required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('[Payment Confirmation Email] Order:', orderId);

    // Get order details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, order_items(*), profiles(*)')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get payment with confirmation code
    const { data: payment } = await supabase
      .from('maisha_payments')
      .select('confirmation_code')
      .eq('order_id', orderId)
      .maybeSingle();

    const confirmationCode = payment?.confirmation_code;

    // Get user email from auth
    const { data: { user } } = await supabase.auth.admin.getUserById(order.user_id);
    const customerEmail = user?.email;

    if (!customerEmail) {
      return new Response(JSON.stringify({ error: 'Customer email not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';

    // Build order items HTML
    const itemsHtml = order.order_items.map((item: any) => `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
          ${item.title || 'Product'}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">
          ${item.quantity}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right;">
          $${Number(item.base_price_usd || 0).toFixed(2)}
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 600;">
          $${(Number(item.base_price_usd || 0) * item.quantity).toFixed(2)}
        </td>
      </tr>
    `).join('');

    // Confirmation code section (only if available)
    const confirmationCodeSection = confirmationCode ? `
      <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 24px; border-radius: 12px; margin: 24px 0; text-align: center;">
        <p style="margin: 0 0 8px 0; color: rgba(255,255,255,0.9); font-size: 14px;">
          Numéro de confirmation / Confirmation Number
        </p>
        <p style="margin: 0; color: white; font-size: 32px; font-weight: 700; font-family: 'Courier New', monospace; letter-spacing: 2px;">
          ${confirmationCode}
        </p>
        <p style="margin: 12px 0 0 0; color: rgba(255,255,255,0.8); font-size: 12px;">
          Conservez ce numéro pour le suivi de votre commande<br>
          Keep this number to track your order
        </p>
      </div>
    ` : '';

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #1f2937; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f3f4f6;">
        <div style="background: linear-gradient(135deg, #0ea5e9 0%, #06b6d4 100%); padding: 40px 20px; text-align: center; border-radius: 12px 12px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 28px;">Paiement confirmé! 🎉</h1>
          <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0; font-size: 16px;">Payment Confirmed</p>
        </div>
        
        <div style="background: white; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="font-size: 16px; margin-top: 0;">
            Bonjour ${order.profiles?.full_name || order.profiles?.name || 'Client'},
          </p>
          
          <p style="font-size: 16px;">
            Excellente nouvelle! Votre paiement a été confirmé et votre commande est en cours de traitement.
          </p>
          <p style="font-size: 14px; color: #6b7280;">
            Great news! Your payment has been confirmed and your order is being processed.
          </p>
          
          ${confirmationCodeSection}
          
          <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin: 24px 0;">
            <h2 style="margin: 0 0 12px 0; font-size: 18px; color: #0ea5e9;">Récapitulatif / Order Summary</h2>
            ${confirmationCode ? `
            <p style="margin: 4px 0; color: #6b7280;">
              <strong>Confirmation:</strong> <span style="font-family: monospace; font-weight: 600; color: #10b981;">${confirmationCode}</span>
            </p>
            ` : ''}
            <p style="margin: 4px 0; color: #6b7280;">
              <strong>N° Commande / Order ID:</strong> ${orderId.slice(0, 8)}...
            </p>
            <p style="margin: 4px 0; color: #6b7280;">
              <strong>Date:</strong> ${new Date(order.created_at).toLocaleDateString('fr-FR')}
            </p>
            <p style="margin: 4px 0; color: #6b7280;">
              <strong>Statut / Status:</strong> <span style="color: #10b981; font-weight: 600;">Payé / Paid</span>
            </p>
          </div>
          
          <h3 style="font-size: 18px; margin: 24px 0 12px 0;">Articles commandés / Order Items</h3>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
            <thead>
              <tr style="background: #f9fafb;">
                <th style="padding: 12px; text-align: left; font-weight: 600; color: #6b7280;">Article</th>
                <th style="padding: 12px; text-align: center; font-weight: 600; color: #6b7280;">Qté</th>
                <th style="padding: 12px; text-align: right; font-weight: 600; color: #6b7280;">Prix</th>
                <th style="padding: 12px; text-align: right; font-weight: 600; color: #6b7280;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${itemsHtml}
            </tbody>
          </table>
          
          <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 24px;">
            <table style="width: 100%;">
              <tr>
                <td style="padding: 4px 0; color: #6b7280;">Sous-total / Subtotal:</td>
                <td style="padding: 4px 0; text-align: right; font-weight: 600;">$${Number(order.item_total_usd || 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; color: #6b7280;">Frais de service / Service Fee:</td>
                <td style="padding: 4px 0; text-align: right; font-weight: 600;">$${Number(order.service_fee_usd || 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; color: #6b7280;">Livraison / Shipping:</td>
                <td style="padding: 4px 0; text-align: right; font-weight: 600;">$${Number(order.shipping_fee_usd || 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td colspan="2" style="padding: 12px 0 0 0; border-top: 2px solid #e5e7eb;"></td>
              </tr>
              <tr>
                <td style="padding: 4px 0; font-size: 18px; font-weight: 700;">Total:</td>
                <td style="padding: 4px 0; text-align: right; font-size: 18px; font-weight: 700; color: #0ea5e9;">$${Number(order.total_usd || 0).toFixed(2)}</td>
              </tr>
              <tr>
                <td colspan="2" style="padding: 4px 0; text-align: center; color: #6b7280; font-size: 14px;">
                  (${Number(order.total_cdf || 0).toLocaleString()} CDF)
                </td>
              </tr>
            </table>
          </div>
          
          <div style="background: #eff6ff; border-left: 4px solid #0ea5e9; padding: 16px; border-radius: 4px; margin: 24px 0;">
            <p style="margin: 0; color: #1e40af; font-weight: 600;">Prochaines étapes / What's Next?</p>
            <p style="margin: 8px 0 0 0; color: #1e40af; font-size: 14px;">
              Votre commande est en préparation. Vous recevrez un email avec les informations de suivi dès l'expédition.<br>
              <span style="color: #6b7280;">Your order is being prepared. You'll receive tracking info once shipped.</span>
            </p>
          </div>
          
          <div style="text-align: center; margin: 24px 0;">
            <a href="${frontendBaseUrl}/track-order${confirmationCode ? `?code=${confirmationCode}` : ''}" 
               style="display: inline-block; background: #0ea5e9; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 8px;">
              📦 Suivre ma commande / Track Order
            </a>
            <a href="${frontendBaseUrl}/orders" 
               style="display: inline-block; background: #f3f4f6; color: #374151; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; margin: 8px; border: 1px solid #e5e7eb;">
              📄 Mes commandes / My Orders
            </a>
          </div>
          
          <p style="margin-top: 24px; color: #6b7280; font-size: 14px;">
            Si vous avez des questions, n'hésitez pas à contacter notre équipe support.<br>
            <span style="color: #9ca3af;">If you have questions, please contact our support team.</span>
          </p>
          
          <p style="margin-top: 32px; font-size: 16px;">
            Cordialement,<br>
            <strong>L'équipe AfriShop</strong>
          </p>
        </div>
        
        <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
          <p style="margin: 0;">© ${new Date().getFullYear()} AfriShop. Tous droits réservés / All rights reserved.</p>
          ${confirmationCode ? `<p style="margin: 8px 0 0 0;">Confirmation: ${confirmationCode}</p>` : ''}
        </div>
      </body>
      </html>
    `;

    const emailResponse = await resend.emails.send({
      from: Deno.env.get('EMAIL_FROM_ADDRESS') || 'AfriShop <onboarding@resend.dev>',
      to: [customerEmail],
      subject: `✅ Paiement confirmé${confirmationCode ? ` - ${confirmationCode}` : ''} / Payment Confirmed`,
      html: emailHtml,
    });

    console.log('[Payment Confirmation Email] Sent:', emailResponse);

    return new Response(JSON.stringify({ success: true, confirmationCode }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[Payment Confirmation Email] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
