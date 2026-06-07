/**
 * send-payment-confirmation
 * Sends a payment receipt email to the customer once their order is PAID.
 * Idempotency is enforced by the caller (payments-webhook / pawapay-callback)
 * via the `payment_confirmation_email_sent_at` column.
 */
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { sendEmail, ADMIN_EMAIL } from "../_shared/email.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const LOGO_URL = "https://igmkhxffnyzoogcqvdab.supabase.co/storage/v1/object/public/email-assets/afrishop-logo.png";
const PLACEHOLDER_IMG = LOGO_URL;
const FRONTEND_BASE = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';

function fmtUsd(n: number | null | undefined) {
  return `${Number(n || 0).toFixed(2)} $US`;
}
function fmtCdf(n: number | null | undefined) {
  return `${Number(n || 0).toLocaleString('fr-CD')} CDF`;
}
function fmtDate(d: string | null | undefined) {
  if (!d) return new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return new Date(d).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function buildReceiptHTML(order: any, items: any[], customerName: string, customerEmail: string, customerPhone?: string | null): string {
  const itemsHtml = (items || []).map((it: any) => {
    const img = it.product_image_url || PLACEHOLDER_IMG;
    const title = (it.title || 'Produit').replace(/</g, '&lt;');
    const qty = it.quantity || 1;
    const line = fmtUsd(it.total_price_usd ?? (it.unit_price_usd || 0) * qty);
    return `
      <tr>
        <td style="padding:12px;border-bottom:1px solid #eee;width:88px;">
          <img src="${img}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:6px;border:1px solid #eee;" />
        </td>
        <td style="padding:12px;border-bottom:1px solid #eee;">
          <div style="font-weight:600;color:#111;">${title}</div>
          <div style="font-size:12px;color:#666;margin-top:4px;">Quantité : <strong>${qty}</strong></div>
        </td>
        <td style="padding:12px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap;color:#111;">${line}</td>
      </tr>`;
  }).join('');

  const orderShort = String(order.id).slice(0, 8).toUpperCase();
  const orderUrl = `${FRONTEND_BASE}/orders/${order.id}`;

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#333;">
  <div style="max-width:640px;margin:0 auto;background:#ffffff;padding:32px 28px;border-radius:10px;margin-top:24px;margin-bottom:24px;">
    <div style="text-align:center;border-bottom:2px solid #2563eb;padding-bottom:18px;margin-bottom:24px;">
      <img src="${LOGO_URL}" alt="AfriShop" style="height:48px;margin-bottom:8px;" />
      <div style="font-size:12px;letter-spacing:2px;color:#666;text-transform:uppercase;">Reçu de paiement</div>
      <div style="display:inline-block;margin-top:10px;padding:6px 16px;background:#22c55e;color:#fff;border-radius:20px;font-size:12px;font-weight:700;">✓ PAYÉ</div>
    </div>

    <p style="font-size:15px;">Bonjour <strong>${customerName}</strong>,</p>
    <p style="font-size:14px;line-height:1.6;color:#444;">
      Nous avons bien reçu votre paiement. Merci pour votre commande&nbsp;! Voici votre reçu officiel.
    </p>

    <table style="width:100%;margin:18px 0 8px;font-size:13px;">
      <tr>
        <td style="padding:4px 0;color:#666;">N° de commande</td>
        <td style="padding:4px 0;text-align:right;"><strong>#${orderShort}</strong></td>
      </tr>
      <tr>
        <td style="padding:4px 0;color:#666;">Date</td>
        <td style="padding:4px 0;text-align:right;">${fmtDate(order.payment_verified_at || order.updated_at)}</td>
      </tr>
      ${order.operator_ref_id ? `<tr><td style="padding:4px 0;color:#666;">Référence</td><td style="padding:4px 0;text-align:right;font-family:monospace;">${order.operator_ref_id}</td></tr>` : ''}
      <tr>
        <td style="padding:4px 0;color:#666;">Client</td>
        <td style="padding:4px 0;text-align:right;">${customerEmail}${customerPhone ? ` · ${customerPhone}` : ''}</td>
      </tr>
    </table>

    <table style="width:100%;border-collapse:collapse;margin-top:14px;">
      <thead>
        <tr><th colspan="3" style="text-align:left;padding:10px 12px;background:#f8f9fa;font-size:11px;letter-spacing:1px;color:#666;text-transform:uppercase;">Articles</th></tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
    </table>

    <div style="margin-top:18px;padding-top:14px;border-top:2px solid #eee;">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#666;padding:4px 0;">
        <span>Livraison et frais de service</span><span><em>inclus</em></span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:18px;font-weight:700;color:#2563eb;border-top:2px solid #2563eb;margin-top:8px;padding-top:12px;">
        <span>Total</span><span>${fmtUsd(order.total_usd)}</span>
      </div>
      ${order.total_cdf ? `<div style="display:flex;justify-content:space-between;font-size:13px;padding:4px 0;"><span>Équivalent CDF</span><span>${fmtCdf(order.total_cdf)}</span></div>` : ''}
    </div>

    <div style="text-align:center;margin:28px 0 8px;">
      <a href="${orderUrl}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;">Voir ma commande</a>
    </div>

    <div style="margin-top:24px;padding-top:18px;border-top:1px solid #eee;text-align:center;color:#888;font-size:12px;">
      <p style="margin:4px 0;">Merci d'avoir commandé sur AfriShop&nbsp;!</p>
      <p style="margin:4px 0;">Pour toute assistance&nbsp;: <a href="mailto:${ADMIN_EMAIL}" style="color:#2563eb;text-decoration:none;">${ADMIN_EMAIL}</a></p>
    </div>
  </div>
</body></html>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const orderId: string | undefined = body?.orderId || body?.order_id;
    if (!orderId) {
      return new Response(JSON.stringify({ ok: false, error: 'orderId required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !order) {
      console.error('[send-payment-confirmation] order not found', orderId, orderErr?.message);
      return new Response(JSON.stringify({ ok: false, error: 'Order not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Resolve customer email - profile first, then auth.users
    let email: string | null = null;
    let fullName = 'Client';
    let phone: string | null = null;
    if (order.user_id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, name, email, phone')
        .eq('user_id', order.user_id)
        .maybeSingle();
      if (profile) {
        email = profile.email || null;
        fullName = profile.full_name || profile.name || fullName;
        phone = profile.phone || null;
      }
      if (!email) {
        const { data: userRes } = await supabase.auth.admin.getUserById(order.user_id);
        email = userRes?.user?.email || null;
      }
    }
    // Guest fallback - check order columns
    if (!email) email = order.guest_email || order.contact_email || order.email || null;

    if (!email) {
      console.warn('[send-payment-confirmation] no email for order', orderId);
      return new Response(JSON.stringify({ ok: false, error: 'No customer email' }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: items } = await supabase
      .from('order_items')
      .select('title, product_image_url, quantity, unit_price_usd, total_price_usd')
      .eq('order_id', orderId)
      .eq('is_saved_for_later', false);

    const html = buildReceiptHTML(order, items || [], fullName, email, phone);
    const subject = `Reçu AfriShop - Commande #${String(order.id).slice(0, 8).toUpperCase()}`;

    const result = await sendEmail({
      to: email,
      subject,
      html,
      category: 'payment_success',
      replyTo: ADMIN_EMAIL,
    });

    if (!result.success) {
      console.error('[send-payment-confirmation] send failed', result.error);
      return new Response(JSON.stringify({ ok: false, error: result.error }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    console.log('[send-payment-confirmation] sent to', email, 'order', orderId, 'id', result.id);
    return new Response(JSON.stringify({ ok: true, emailId: result.id, to: email }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[send-payment-confirmation] error', e?.message);
    return new Response(JSON.stringify({ ok: false, error: e?.message || 'error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
