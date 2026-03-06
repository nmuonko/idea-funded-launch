import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
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

    const orderRef = orderId.slice(0, 8).toUpperCase();
    const sectionDivider = `<hr style="margin: 25px 0; border: none; border-top: 1px solid #e5e7eb;" />`;
    const enLabel = `<p style="color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">🇬🇧 English</p>`;
    const frLabel = `<p style="color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">🇫🇷 Français</p>`;
    const headerStyle = `background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 30px; text-align: center;`;
    const footerHtml = `<div style="background: #1e3a5f; padding: 20px; text-align: center; color: white; font-size: 12px;"><p style="margin: 0;">© ${new Date().getFullYear()} AfriShop — Shopping sans frontières 🌍</p></div>`;

    const itemsHtml = order.order_items?.length > 0 ? `
      <h3>Articles / Items:</h3>
      <ul>${order.order_items.map((item: any) => `<li>${item.title || 'Product'} - Qty: ${item.quantity} - $${Number(item.total_price_usd || item.unit_price_usd || 0).toFixed(2)}</li>`).join('')}</ul>
    ` : '';

    switch (templateType) {
      case 'order_confirmed':
        subject = `✅ Commande confirmée / Order Confirmed - #${orderRef} | AfriShop`;
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="${headerStyle}">
              <h1 style="color: white; margin: 0;">Commande confirmée ! 🎉</h1>
              <p style="color: #93c5fd; margin: 8px 0 0;">Order Confirmed!</p>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              ${frLabel}
              <p>Bonjour ${customerName},</p>
              <p>Merci pour votre commande ! Nous l'avons bien reçue et allons commencer à la traiter sous peu.</p>
              <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>N° de commande :</strong> ${orderRef}</p>
                <p><strong>Total :</strong> $${Number(order.total_usd || 0).toFixed(2)}</p>
              </div>
              ${itemsHtml}
              <p>Nous vous enverrons un email lorsque votre commande sera expédiée.</p>

              ${sectionDivider}
              ${enLabel}
              <p>Hello ${customerName},</p>
              <p>Thank you for your order! We've received it and will begin processing it shortly.</p>
              <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Order ID:</strong> ${orderRef}</p>
                <p><strong>Total:</strong> $${Number(order.total_usd || 0).toFixed(2)}</p>
              </div>
              <p>We'll notify you when your order ships.</p>
            </div>
            ${footerHtml}
          </div>
        `;
        break;

      case 'payment_verified':
        subject = `💰 Paiement vérifié / Payment Verified - #${orderRef} | AfriShop`;
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="${headerStyle}">
              <h1 style="color: white; margin: 0;">✓ Paiement vérifié !</h1>
              <p style="color: #93c5fd; margin: 8px 0 0;">Payment Verified!</p>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              ${frLabel}
              <p>Bonjour ${customerName},</p>
              <p>Bonne nouvelle ! Nous avons vérifié votre paiement pour la commande <strong>#${orderRef}</strong>.</p>
              <div style="background: #d1fae5; padding: 20px; border-radius: 8px; border-left: 4px solid #059669; margin: 20px 0;">
                <p style="margin: 0; color: #065f46;"><strong>✓ Paiement confirmé</strong></p>
                <p style="margin: 10px 0 0 0; color: #065f46;">Montant : $${Number(order.total_usd || 0).toFixed(2)}</p>
              </div>
              <p>Votre commande est maintenant en préparation pour l'expédition.</p>

              ${sectionDivider}
              ${enLabel}
              <p>Hello ${customerName},</p>
              <p>Great news! We've verified your payment for order <strong>#${orderRef}</strong>.</p>
              <div style="background: #d1fae5; padding: 20px; border-radius: 8px; border-left: 4px solid #059669; margin: 20px 0;">
                <p style="margin: 0; color: #065f46;"><strong>✓ Payment Confirmed</strong></p>
                <p style="margin: 10px 0 0 0; color: #065f46;">Amount: $${Number(order.total_usd || 0).toFixed(2)}</p>
              </div>
              <p>Your order is now being prepared for shipment.</p>
            </div>
            ${footerHtml}
          </div>
        `;
        break;

      case 'order_shipped':
        subject = `🚚 Commande #${orderRef} expédiée / Order Shipped | AfriShop`;
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="${headerStyle}">
              <h1 style="color: white; margin: 0;">🚚 Commande expédiée !</h1>
              <p style="color: #93c5fd; margin: 8px 0 0;">Order Shipped!</p>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              ${frLabel}
              <p>Bonjour ${customerName},</p>
              <p>Votre commande <strong>#${orderRef}</strong> est en route !</p>
              <div style="background: #ede9fe; padding: 20px; border-radius: 8px; border-left: 4px solid #7c3aed; margin: 20px 0;">
                ${order.tracking_number ? `
                  <p style="margin: 0; color: #5b21b6;"><strong>N° de suivi :</strong> ${order.tracking_number}</p>
                  <p style="margin: 10px 0 0 0; color: #5b21b6;"><strong>Transporteur :</strong> ${order.carrier || 'N/A'}</p>
                ` : `<p style="margin: 0; color: #5b21b6;"><strong>Statut :</strong> En transit</p>`}
              </div>
              <p><strong>Destination :</strong> ${order.shipping_city || 'N/A'}</p>
              ${order.estimated_delivery ? `<p><strong>Livraison estimée :</strong> ${new Date(order.estimated_delivery).toLocaleDateString('fr-FR')}</p>` : ''}

              ${sectionDivider}
              ${enLabel}
              <p>Hello ${customerName},</p>
              <p>Your order <strong>#${orderRef}</strong> is on its way!</p>
              <div style="background: #ede9fe; padding: 20px; border-radius: 8px; border-left: 4px solid #7c3aed; margin: 20px 0;">
                ${order.tracking_number ? `
                  <p style="margin: 0; color: #5b21b6;"><strong>Tracking Number:</strong> ${order.tracking_number}</p>
                  <p style="margin: 10px 0 0 0; color: #5b21b6;"><strong>Carrier:</strong> ${order.carrier || 'N/A'}</p>
                ` : `<p style="margin: 0; color: #5b21b6;"><strong>Status:</strong> In Transit</p>`}
              </div>
              <p><strong>Shipping to:</strong> ${order.shipping_city || 'N/A'}</p>
              ${order.estimated_delivery ? `<p><strong>Estimated Delivery:</strong> ${new Date(order.estimated_delivery).toLocaleDateString('en-US')}</p>` : ''}
            </div>
            ${footerHtml}
          </div>
        `;
        break;

      case 'order_delivered':
        subject = `✅ Commande #${orderRef} livrée / Order Delivered | AfriShop`;
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="${headerStyle}">
              <h1 style="color: white; margin: 0;">✓ Commande livrée !</h1>
              <p style="color: #a7f3d0; margin: 8px 0 0;">Order Delivered!</p>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              ${frLabel}
              <p>Bonjour ${customerName},</p>
              <p>Bonne nouvelle ! Votre commande <strong>#${orderRef}</strong> a été livrée.</p>
              <div style="background: #d1fae5; padding: 20px; border-radius: 8px; border-left: 4px solid #059669; margin: 20px 0;">
                <p style="margin: 0; color: #065f46; font-size: 18px;"><strong>✓ Livraison confirmée</strong></p>
                <p style="margin: 10px 0 0 0; color: #065f46;">Livrée le : ${new Date().toLocaleDateString('fr-FR')}</p>
              </div>
              <p>Nous espérons que vous apprécierez votre achat ! N'hésitez pas à nous contacter pour toute question.</p>

              ${sectionDivider}
              ${enLabel}
              <p>Hello ${customerName},</p>
              <p>Great news! Your order <strong>#${orderRef}</strong> has been delivered.</p>
              <div style="background: #d1fae5; padding: 20px; border-radius: 8px; border-left: 4px solid #059669; margin: 20px 0;">
                <p style="margin: 0; color: #065f46; font-size: 18px;"><strong>✓ Successfully Delivered</strong></p>
                <p style="margin: 10px 0 0 0; color: #065f46;">Delivered on: ${new Date().toLocaleDateString('en-US')}</p>
              </div>
              <p>We hope you enjoy your purchase! If you have any questions, please don't hesitate to reach out.</p>
            </div>
            ${footerHtml}
          </div>
        `;
        break;

      case 'custom':
        subject = customSubject || `📋 Mise à jour commande / Order Update - #${orderRef} | AfriShop`;
        html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="${headerStyle}">
              <h1 style="color: white; margin: 0;">Mise à jour de commande</h1>
              <p style="color: #93c5fd; margin: 8px 0 0;">Order Update</p>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              <p>Bonjour / Hello ${customerName},</p>
              
              <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p style="white-space: pre-wrap;">${customMessage || 'Nous avons une mise à jour concernant votre commande. / We have an update regarding your order.'}</p>
              </div>

              <p><strong>N° de commande / Order ID:</strong> ${orderRef}</p>

              <p style="color: #6b7280; margin-top: 30px;">
                Si vous avez des questions, veuillez contacter notre équipe d'assistance.<br>
                If you have any questions, please contact our support team.
              </p>
              <p style="color: #6b7280;">
                Cordialement / Best regards,<br>
                <strong>AfriShop</strong>
              </p>
            </div>
            ${footerHtml}
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
