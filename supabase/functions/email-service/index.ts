/**
 * email-service — Consolidated Email Service
 * 
 * Single entry point for all email/notification sending.
 * Routes by `type` field in POST body to the appropriate send-* function.
 * Some types (order_assistance) are handled inline to avoid forwarding issues.
 * 
 * AUTH: All actions require a valid JWT (via getUser) or cron secret.
 * Exception: cart_reminder and abandoned_cart may be triggered by cron.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { sendEmail, ADMIN_EMAIL } from "../_shared/email.ts";
import { buildOrderAssistanceEmail, AssistanceEmailLanguage } from "../_shared/emailTemplates.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function requireAuth(req: Request): Promise<{ userId: string } | Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonRes({ ok: false, error: 'Unauthorized: missing Bearer token' }, 401);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return jsonRes({ ok: false, error: 'Unauthorized: invalid token' }, 401);
  }

  return { userId: user.id };
}

function hasCronSecret(req: Request): boolean {
  const cronSecret = req.headers.get('x-cron-secret');
  const expected = Deno.env.get('CRON_SECRET');
  return !!(cronSecret && expected && cronSecret === expected);
}

// Email types that can be triggered by cron jobs
const CRON_TYPES = new Set(['cart_reminder', 'abandoned_cart', 'abandoned_cart_recovery', 'saved_cart_reminders']);

// Types handled inline (not forwarded)
const INLINE_TYPES = new Set(['order_assistance', 'abandoned_cart_recovery']);

const TYPE_TO_FUNCTION: Record<string, string> = {
  // Order lifecycle
  order_email: 'send-order-email',
  order_confirmation: 'send-order-confirmation',
  confirmation_email: 'send-confirmation-email',
  order_processing: 'send-order-processing-email',
  order_ready: 'send-order-ready-email',
  order_shipped: 'send-order-shipped-email',
  order_delivered: 'send-order-delivered-email',
  order_assistance: 'send-order-assistance-email',

  // Payment
  payment_confirmation: 'send-payment-confirmation',
  payment_confirmation_email: 'send-payment-confirmation-email',
  admin_payment_notification: 'send-admin-payment-notification',

  // Shipping / Delivery
  shipping_notification: 'send-shipping-notification',
  shipping_update: 'send-shipping-update',
  delivery_notification: 'send-delivery-notification',

  // Cart recovery
  cart_reminder: 'send-cart-reminder-emails',
  abandoned_cart: 'send-abandoned-cart-emails',
  abandoned_cart_recovery: 'send-abandoned-cart-recovery',

  // Quotes
  quote_email: 'send-quote-email',
  quote_response: 'send-quote-response-notification',

  // Support
  ticket_notification: 'send-ticket-notification',
  feedback: 'send-feedback-email',
  fraud_alert: 'send-fraud-alert-email',

  // Customer / General
  customer_email: 'send-customer-email',
  application_email: 'send-application-emails',
  test_email: 'send-test-email',
  saved_cart_reminders: 'saved-cart-reminders',

  // Push notifications
  push_notification: 'send-push-notification',
};

// ==================== Inline Handlers ====================

const VALID_LANGUAGES: AssistanceEmailLanguage[] = ['en', 'fr', 'sw', 'ln', 'en_sw'];

async function handleOrderAssistance(body: any, userId: string): Promise<Response> {
  const { orderId, language = 'fr' } = body;

  if (!orderId) {
    return jsonRes({ ok: false, error: 'orderId is required' }, 400);
  }

  const validatedLanguage: AssistanceEmailLanguage = VALID_LANGUAGES.includes(language as AssistanceEmailLanguage)
    ? (language as AssistanceEmailLanguage)
    : 'fr';

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const serviceClient = createClient(supabaseUrl, serviceKey);

  // Fetch order with profile
  const { data: order, error: orderError } = await serviceClient
    .from('orders')
    .select('id, status, total_usd, user_id, profiles(name, email, full_name)')
    .eq('id', orderId)
    .maybeSingle();

  if (orderError || !order) {
    console.error('[order_assistance] Order fetch error:', orderError?.message);
    return jsonRes({ ok: false, error: 'Order not found' }, 404);
  }

  console.log(`[order_assistance] Order ${orderId} status=${order.status} total=$${order.total_usd}`);

  // Allow incomplete statuses
  if (!['DRAFT', 'PENDING_PAYMENT'].includes(order.status)) {
    return jsonRes({ ok: false, error: `Email only for incomplete orders. Current status: ${order.status}` }, 400);
  }

  const profile = order.profiles as any;
  const customerEmail = profile?.email;
  const customerName = profile?.full_name || profile?.name || 'Customer';

  if (!customerEmail) {
    console.error('[order_assistance] No customer email for order', orderId);
    return jsonRes({ ok: false, error: 'Customer email not found on profile' }, 400);
  }

  // Get item count
  const { data: items } = await serviceClient
    .from('order_items')
    .select('id')
    .eq('order_id', orderId)
    .eq('is_saved_for_later', false);

  const itemCount = items?.length || 0;

  // Get support contact
  const { data: supportContact } = await serviceClient
    .from('settings')
    .select('support_whatsapp, support_email')
    .limit(1)
    .maybeSingle();

  const supportWhatsapp = supportContact?.support_whatsapp || '243973141627';
  const supportEmail = supportContact?.support_email || 'nkadimisha@afrishop-usa.com';
  const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';

  // Build and send email
  const emailTemplate = buildOrderAssistanceEmail({
    customerName,
    orderId,
    itemCount,
    totalUsd: Number(order.total_usd || 0),
    frontendBaseUrl,
    language: validatedLanguage,
    supportWhatsapp,
    supportEmail,
  });

  console.log(`[order_assistance] Sending ${validatedLanguage} email to ${customerEmail}`);

  const emailResult = await sendEmail({
    to: customerEmail,
    subject: emailTemplate.subject,
    html: emailTemplate.html,
    category: 'customer_email',
    replyTo: ADMIN_EMAIL,
  });

  if (!emailResult.success) {
    console.error('[order_assistance] Email send failed:', emailResult.error);
    return jsonRes({ ok: false, error: `Failed to send email: ${emailResult.error}` }, 500);
  }

  // Log to customer_email_logs
  await serviceClient.from('customer_email_logs').insert({
    customer_id: order.user_id,
    customer_email: customerEmail,
    subject: emailTemplate.subject,
    body: emailTemplate.html,
    sent_by: userId,
    status: 'sent',
  });

  console.log(`[order_assistance] ✅ Email sent to ${customerEmail} for order ${orderId}`);

  return jsonRes({
    ok: true,
    success: true,
    message: `Assistance email sent to ${customerEmail}`,
    language: validatedLanguage,
    emailId: emailResult.id,
  });
}

// ==================== Cart Recovery Inline Handler ====================

type CartRecoveryLang = 'fr' | 'en' | 'sw' | 'ln';

const CART_RECOVERY_STRINGS: Record<CartRecoveryLang, {
  subject: string; greeting: string; body: string; cta: string;
  helpTitle: string; whatsappBtn: string; emailBtn: string; footer: string;
  pasteLinkTitle: string; pasteLinkBody: string; pasteLinkCta: string;
}> = {
  fr: {
    subject: 'Votre panier vous attend! 🛒',
    greeting: 'Bonjour {name},',
    body: 'Vous avez {count} article(s) dans votre panier pour un total de ${total} USD. Finalisez votre commande dès maintenant!',
    cta: 'Finaliser ma commande',
    helpTitle: 'Besoin d\'aide?',
    whatsappBtn: '💬 Contactez-nous sur WhatsApp',
    emailBtn: '📧 Envoyez-nous un email',
    footer: 'Merci de faire confiance à AfriShop! Si vous ne souhaitez plus recevoir ces rappels, ignorez cet email.',
    pasteLinkTitle: '🔗 Vous ne trouvez pas ce que vous cherchez?',
    pasteLinkBody: 'Choisissez un magasin américain (Amazon, Walmart, Temu, SHEIN…), copiez le lien du produit et collez-le pour obtenir le prix complet avec livraison.',
    pasteLinkCta: 'Coller un lien maintenant',
  },
  en: {
    subject: 'Your cart is waiting! 🛒',
    greeting: 'Hi {name},',
    body: 'You have {count} item(s) in your cart totaling ${total} USD. Complete your order now!',
    cta: 'Complete My Order',
    helpTitle: 'Need help?',
    whatsappBtn: '💬 Contact us on WhatsApp',
    emailBtn: '📧 Send us an email',
    footer: 'Thank you for shopping with AfriShop! If you no longer wish to receive these reminders, simply ignore this email.',
    pasteLinkTitle: '🔗 Can\'t find what you\'re looking for?',
    pasteLinkBody: 'Choose any US store (Amazon, Walmart, Temu, SHEIN…), copy the product link and paste it to get the full price including shipping.',
    pasteLinkCta: 'Paste a Link Now',
  },
  sw: {
    subject: 'Kikapu chako kinakungoja! 🛒',
    greeting: 'Habari {name},',
    body: 'Una bidhaa {count} katika kikapu chako kwa jumla ya ${total} USD. Kamilisha oda yako sasa!',
    cta: 'Kamilisha Oda Yangu',
    helpTitle: 'Unahitaji msaada?',
    whatsappBtn: '💬 Wasiliana nasi WhatsApp',
    emailBtn: '📧 Tutumie barua pepe',
    footer: 'Asante kwa kununua na AfriShop!',
    pasteLinkTitle: '🔗 Hupati unachotafuta?',
    pasteLinkBody: 'Chagua duka la Marekani, nakili kiungo na ubandike ili kupata bei kamili pamoja na usafirishaji.',
    pasteLinkCta: 'Bandika Kiungo Sasa',
  },
  ln: {
    subject: 'Panier na yo ezali kozela yo! 🛒',
    greeting: 'Mbote {name},',
    body: 'Ozali na biloko {count} na panier na yo ya ${total} USD. Sukisa commande na yo sikoyo!',
    cta: 'Sukisa commande na ngai',
    helpTitle: 'Osengeli na lisalisi?',
    whatsappBtn: '💬 Solola na biso na WhatsApp',
    emailBtn: '📧 Tindela biso email',
    footer: 'Merci ndenge osombi na AfriShop!',
    pasteLinkTitle: '🔗 Ozali kozwa te oyo ozali koluka?',
    pasteLinkBody: 'Poná magazin ya Amerika, kopya lien ya produit mpe koller yango pona kozwa ntalo mobimba na livraison.',
    pasteLinkCta: 'Koller lien sikoyo',
  },
};

function buildCartRecoveryHtml(opts: {
  strings: typeof CART_RECOVERY_STRINGS['fr'];
  customerName: string;
  itemCount: number;
  totalUsd: number;
  items: Array<{ title: string; image_url?: string; quantity: number }>;
  cartUrl: string;
  whatsappUrl: string;
  supportEmail: string;
}): string {
  const { strings: s, customerName, itemCount, totalUsd, items, cartUrl, whatsappUrl, supportEmail } = opts;

  const itemsHtml = items.slice(0, 3).map(item => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;">
        ${item.image_url ? `<img src="${item.image_url}" width="50" height="50" style="border-radius:6px;object-fit:cover;" alt="" />` : ''}
      </td>
      <td style="padding:8px;border-bottom:1px solid #eee;font-size:14px;">${item.title || 'Product'}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;font-size:14px;text-align:center;">x${item.quantity}</td>
    </tr>
  `).join('');

  const bodyText = s.body
    .replace('{count}', String(itemCount))
    .replace('{total}', totalUsd.toFixed(2));

  return `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;margin-top:20px;margin-bottom:20px;">
  <div style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:30px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;">🛒 AfriShop</h1>
  </div>
  <div style="padding:30px;">
    <p style="font-size:16px;color:#333;">${s.greeting.replace('{name}', customerName)}</p>
    <p style="font-size:15px;color:#555;line-height:1.6;">${bodyText}</p>
    ${itemsHtml ? `<table style="width:100%;border-collapse:collapse;margin:20px 0;">${itemsHtml}</table>` : ''}
    ${itemCount > 3 ? `<p style="font-size:13px;color:#888;text-align:center;">+${itemCount - 3} more item(s)</p>` : ''}
    <div style="text-align:center;margin:30px 0;">
      <a href="${cartUrl}" style="display:inline-block;background:#f59e0b;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;">${s.cta}</a>
    </div>
    <hr style="border:none;border-top:1px solid #eee;margin:30px 0;" />
    <h3 style="color:#333;margin-bottom:15px;">${s.helpTitle}</h3>
    <div style="text-align:center;">
      <a href="${whatsappUrl}" style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;padding:10px 24px;border-radius:6px;font-size:14px;margin:5px;">${s.whatsappBtn}</a>
      <a href="mailto:${supportEmail}?subject=Help%20with%20my%20order" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:10px 24px;border-radius:6px;font-size:14px;margin:5px;">${s.emailBtn}</a>
    </div>
  </div>
  <div style="background:#f9fafb;padding:20px;text-align:center;font-size:12px;color:#999;">
    ${s.footer}
  </div>
</div>
</body></html>`;
}

async function handleCartRecovery(body: any, _userId: string | undefined): Promise<Response> {
  const { hoursThreshold = 48, language = 'fr', preview = false, preview_html = false } = body;

  const lang: CartRecoveryLang = ['fr', 'en', 'sw', 'ln'].includes(language) ? language : 'fr';

  // If preview_html is requested, return a sample email without querying real orders
  if (preview_html) {
    const strings = CART_RECOVERY_STRINGS[lang];
    const sampleHtml = buildCartRecoveryHtml({
      strings,
      customerName: 'Jean Dupont',
      itemCount: 3,
      totalUsd: 245.99,
      items: [
        { title: 'Wax Print Fabric (6 yards)', image_url: undefined, quantity: 2 },
        { title: 'Shea Butter - 500g', image_url: undefined, quantity: 1 },
        { title: 'Palm Oil - 1L', image_url: undefined, quantity: 1 },
      ],
      cartUrl: 'https://afrishop-usa.com/cart',
      whatsappUrl: 'https://wa.me/243973141627?text=Hi',
      supportEmail: 'nkadimisha@afrishop-usa.com',
    });
    return jsonRes({ ok: true, html: sampleHtml, subject: strings.subject });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const sc = createClient(supabaseUrl, serviceKey);

  const cutoff = new Date(Date.now() - hoursThreshold * 60 * 60 * 1000).toISOString();

  // Find eligible orders
  const { data: eligibleOrders, error: qErr } = await sc
    .from('orders')
    .select('id, status, total_usd, user_id, cart_reminder_sent_at, created_at, profiles(name, full_name, email)')
    .in('status', ['DRAFT', 'PENDING_PAYMENT'])
    .is('cart_reminder_sent_at', null)
    .lt('created_at', cutoff);

  if (qErr) {
    console.error('[cart_recovery] Query error:', qErr.message);
    return jsonRes({ ok: false, error: qErr.message }, 500);
  }

  // Filter orders that have at least 1 item
  const ordersWithItems: typeof eligibleOrders = [];
  for (const order of (eligibleOrders || [])) {
    const { data: items } = await sc
      .from('order_items')
      .select('id')
      .eq('order_id', order.id)
      .eq('is_saved_for_later', false)
      .limit(1);
    if (items && items.length > 0) {
      ordersWithItems.push(order);
    }
  }

  if (preview) {
    return jsonRes({ ok: true, count: ordersWithItems.length });
  }

  // Fetch support contact info dynamically
  const { data: settings } = await sc
    .from('settings')
    .select('support_whatsapp, support_email')
    .limit(1)
    .maybeSingle();

  const whatsappNumber = (settings?.support_whatsapp || '+243973141627').replace(/[^0-9]/g, '');
  const supportEmailAddr = settings?.support_email || 'nkadimisha@afrishop-usa.com';
  const frontendBase = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';
  const cartUrl = `${frontendBase}/cart`;
  const strings = CART_RECOVERY_STRINGS[lang];

  let sent = 0;
  let skipped = 0;

  for (const order of ordersWithItems) {
    const profile = order.profiles as any;
    const customerEmail = profile?.email;
    if (!customerEmail) { skipped++; continue; }

    const customerName = profile?.full_name || profile?.name || 'Customer';

    // Get items for this order (up to 3 for preview)
    const { data: orderItems } = await sc
      .from('order_items')
      .select('title, product_image_url, quantity')
      .eq('order_id', order.id)
      .eq('is_saved_for_later', false)
      .limit(4);

    const itemCount = orderItems?.length || 0;
    const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(`Hi, I need help with my order ${order.id}`)}`;

    const html = buildCartRecoveryHtml({
      strings,
      customerName,
      itemCount,
      totalUsd: Number(order.total_usd || 0),
      items: (orderItems || []).map((i: any) => ({ title: i.title, image_url: i.product_image_url, quantity: i.quantity })),
      cartUrl,
      whatsappUrl,
      supportEmail: supportEmailAddr,
    });

    const emailResult = await sendEmail({
      to: customerEmail,
      subject: strings.subject,
      html,
      category: 'cart_recovery',
      replyTo: supportEmailAddr,
    });

    if (emailResult.success) {
      sent++;
      // Mark order as reminded
      await sc.from('orders').update({ cart_reminder_sent_at: new Date().toISOString() } as any).eq('id', order.id);
      // Log
      await sc.from('customer_email_logs').insert({
        customer_id: order.user_id,
        customer_email: customerEmail,
        subject: strings.subject,
        body: html,
        sent_by: _userId || 'system',
        status: 'sent',
      });
    } else {
      skipped++;
      console.error(`[cart_recovery] Failed for ${customerEmail}:`, emailResult.error);
    }
  }

  console.log(`[cart_recovery] Done: sent=${sent}, skipped=${skipped}`);
  return jsonRes({ ok: true, sent, skipped });
}

// ==================== Forwarding ====================

async function forwardToFunction(functionName: string, req: Request, overrideBody?: unknown): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  if (!supabaseUrl) {
    return jsonRes({ ok: false, error: 'SUPABASE_URL not configured' }, 500);
  }

  const targetUrl = `${supabaseUrl}/functions/v1/${functionName}`;

  const headers = new Headers();
  const authHeader = req.headers.get('Authorization');
  if (authHeader) headers.set('Authorization', authHeader);
  headers.set('Content-Type', 'application/json');

  for (const h of ['x-device-id', 'user-agent', 'x-client-info', 'x-cron-secret']) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }

  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
  headers.set('apikey', anonKey);

  const fetchOpts: RequestInit = {
    method: 'POST',
    headers,
  };

  if (overrideBody !== undefined) {
    fetchOpts.body = JSON.stringify(overrideBody);
  }

  const response = await fetch(targetUrl, fetchOpts);
  const responseBody = await response.text();
  return new Response(responseBody, {
    status: response.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ==================== Main Handler ====================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonRes({ ok: false, error: 'Method not allowed' }, 405);
  }

  try {
    const body = await req.json();
    const emailType = body?.type;

    if (!emailType) {
      return jsonRes({ ok: false, error: 'Missing type field. Expected one of: ' + Object.keys(TYPE_TO_FUNCTION).join(', ') }, 400);
    }

    const targetFunction = TYPE_TO_FUNCTION[emailType];
    if (!targetFunction && !INLINE_TYPES.has(emailType)) {
      return jsonRes({ ok: false, error: `Unknown email type: ${emailType}` }, 400);
    }

    // Auth gate: require JWT or cron secret
    let authUserId: string | undefined;
    if (CRON_TYPES.has(emailType) && hasCronSecret(req)) {
      // Cron-authenticated — proceed
    } else {
      const authResult = await requireAuth(req);
      if (authResult instanceof Response) return authResult;
      authUserId = authResult.userId;
    }

    console.log(`[email-service] Handling type="${emailType}" userId=${authUserId || 'cron'}`);

    // Handle inline types
    if (emailType === 'order_assistance' && authUserId) {
      return handleOrderAssistance(body, authUserId);
    }
    if (emailType === 'abandoned_cart_recovery') {
      return handleCartRecovery(body, authUserId);
    }

    // Forward to separate function
    const { type: _t, ...payload } = body;
    return forwardToFunction(targetFunction!, req, payload);
  } catch (err: any) {
    console.error('[email-service] Unexpected error:', err);
    return jsonRes({ ok: false, error: err.message || 'Internal error' }, 500);
  }
});
