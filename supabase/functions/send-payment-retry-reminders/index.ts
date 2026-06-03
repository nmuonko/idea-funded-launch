// Sends a "your payment didn't go through, tap to retry" email to customers
// whose orders were auto-expired in the last 15 minutes.
// Triggered every 5 minutes by pg_cron with x-cron-secret header.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyCronAuth, cronAuthErrorResponse } from '../_shared/cronAuth.ts';
import { sendEmail } from '../_shared/email.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const SITE_URL = 'https://afrishop-usa.com';

type Lang = 'fr' | 'en';

function renderEmail(opts: {
  name: string | null;
  orderId: string;
  totalUsd: number | null;
  lang: Lang;
}) {
  const { name, orderId, totalUsd, lang } = opts;
  const retryUrl = `${SITE_URL}/orders/${orderId}?retry=1`;
  const hi = name ? (lang === 'fr' ? `Bonjour ${name},` : `Hi ${name},`) : (lang === 'fr' ? 'Bonjour,' : 'Hi,');
  const amount = totalUsd != null ? `$${Number(totalUsd).toFixed(2)}` : '';

  if (lang === 'fr') {
    return {
      subject: `Votre paiement AfriShop n'a pas abouti — finalisez en 1 clic`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
          <h2 style="margin:0 0 12px">${hi}</h2>
          <p>Nous avons remarqué que votre commande ${amount ? `de <b>${amount}</b> ` : ''}n'a pas pu être finalisée — le paiement Mobile Money n'a pas été approuvé à temps.</p>
          <p>Pas d'inquiétude, votre panier est sauvegardé. Tapez sur le bouton ci-dessous pour réessayer :</p>
          <p style="text-align:center;margin:28px 0">
            <a href="${retryUrl}" style="background:#16a34a;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Finaliser mon paiement</a>
          </p>
          <p style="font-size:13px;color:#555">Si vous avez besoin d'aide, répondez à cet email ou contactez-nous sur WhatsApp au +243 973 141 627.</p>
          <p style="font-size:12px;color:#999;margin-top:24px">Référence commande : ${orderId.slice(0, 8).toUpperCase()}</p>
        </div>`,
    };
  }
  return {
    subject: `Your AfriShop payment didn't go through — finish in 1 tap`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
        <h2 style="margin:0 0 12px">${hi}</h2>
        <p>We noticed your order ${amount ? `of <b>${amount}</b> ` : ''}didn't go through — the Mobile Money payment wasn't approved in time.</p>
        <p>No worries, your cart is saved. Tap the button below to retry:</p>
        <p style="text-align:center;margin:28px 0">
          <a href="${retryUrl}" style="background:#16a34a;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Complete my payment</a>
        </p>
        <p style="font-size:13px;color:#555">Need help? Reply to this email or message us on WhatsApp at +243 973 141 627.</p>
        <p style="font-size:12px;color:#999;margin-top:24px">Order ref: ${orderId.slice(0, 8).toUpperCase()}</p>
      </div>`,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const auth = verifyCronAuth(req);
  if (!auth.authorized) return cronAuthErrorResponse(auth.error || 'unauthorized');

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Find recently auto-expired orders not yet emailed
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, user_id, total_usd, updated_at')
    .eq('status', 'CANCELLED')
    .eq('cancel_reason', 'auto_expired_no_payment')
    .is('payment_retry_email_sent_at', null)
    .gte('updated_at', new Date(Date.now() - 20 * 60 * 1000).toISOString())
    .limit(50);

  if (error) {
    console.error('[retry-reminders] query failed', error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!orders || orders.length === 0) {
    return new Response(JSON.stringify({ ok: true, sent: 0, scanned: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userIds = [...new Set(orders.map((o: any) => o.user_id))];
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, email, full_name, name, language')
    .in('user_id', userIds);
  const pmap = new Map<string, any>((profiles || []).map((p: any) => [p.user_id, p]));

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const o of orders as any[]) {
    const profile = pmap.get(o.user_id);
    if (!profile?.email) {
      skipped++;
      // Mark anyway so we don't keep scanning forever
      await supabase
        .from('orders')
        .update({ payment_retry_email_sent_at: new Date().toISOString() })
        .eq('id', o.id);
      continue;
    }
    const lang: Lang = (profile.language === 'en' ? 'en' : 'fr');
    const { subject, html } = renderEmail({
      name: profile.full_name || profile.name || null,
      orderId: o.id,
      totalUsd: o.total_usd,
      lang,
    });
    const res = await sendEmail({
      to: profile.email,
      subject,
      html,
      category: 'cart_recovery',
    });
    if (res.success) {
      sent++;
      await supabase
        .from('orders')
        .update({ payment_retry_email_sent_at: new Date().toISOString() })
        .eq('id', o.id);
    } else {
      failed++;
      console.error('[retry-reminders] send failed', o.id, res.error);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, scanned: orders.length, sent, skipped, failed }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
