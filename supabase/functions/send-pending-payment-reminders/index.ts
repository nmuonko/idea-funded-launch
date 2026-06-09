// Sends up to 9 reminders to customers whose orders are still PENDING_PAYMENT.
// Schedule (Kinshasa local time, UTC+1):
//   Day 0 (initiation day): +2h, +4h, +6h after order creation
//   Day +2 (2 days later):  10:00, 12:00, 14:00 local
//   Day +5 (5 days later):  10:00, 12:00, 14:00 local
// Each slot only fires inside the 08:00–20:00 Kinshasa daytime window.
// Triggered every 30 minutes by pg_cron (x-cron-secret).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyCronAuth, cronAuthErrorResponse } from '../_shared/cronAuth.ts';
import { sendEmail } from '../_shared/email.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const SITE_URL = 'https://afrishop-usa.com';
const KINSHASA_OFFSET_HOURS = 1; // UTC+1, no DST
const DAY_START_HOUR = 8;        // 08:00 local
const DAY_END_HOUR = 20;         // 20:00 local

type Lang = 'fr' | 'en';

/** Convert a UTC Date to Kinshasa-local components. */
function toKinshasa(d: Date) {
  const local = new Date(d.getTime() + KINSHASA_OFFSET_HOURS * 3600_000);
  return {
    y: local.getUTCFullYear(),
    m: local.getUTCMonth(),
    d: local.getUTCDate(),
    h: local.getUTCHours(),
    min: local.getUTCMinutes(),
  };
}

/** Build a UTC Date from Kinshasa-local y/m/d/h/min. */
function fromKinshasa(y: number, m: number, d: number, h: number, min = 0): Date {
  // Date.UTC treats inputs as UTC; subtract offset to get the equivalent UTC instant.
  return new Date(Date.UTC(y, m, d, h - KINSHASA_OFFSET_HOURS, min, 0));
}

/**
 * Compute the 9 scheduled UTC timestamps for an order.
 * Slots that fall outside the daytime window are pushed to 09:00 the next morning,
 * preserving order.
 */
function computeSlots(createdAt: Date): Date[] {
  const created = createdAt;
  const baseOffsets = [2, 4, 6]; // hours after creation, day 0
  const slots: Date[] = [];

  // Day 0 slots: created + 2/4/6h
  for (const off of baseOffsets) {
    slots.push(new Date(created.getTime() + off * 3600_000));
  }

  // Day +2 and +5 slots: 10/12/14 local
  const localCreated = toKinshasa(created);
  for (const dayOffset of [2, 5]) {
    for (const hour of [10, 12, 14]) {
      slots.push(fromKinshasa(localCreated.y, localCreated.m, localCreated.d + dayOffset, hour, 0));
    }
  }

  // Clamp every slot into the daytime window (Kinshasa local).
  // If outside, defer to 09:00 local the next day; keep slots strictly increasing.
  const clamped: Date[] = [];
  let prev: Date | null = null;
  for (const s of slots) {
    let candidate = clampToDaytime(s);
    if (prev && candidate.getTime() <= prev.getTime()) {
      // Push at least 30 min after the previous one and re-clamp
      candidate = clampToDaytime(new Date(prev.getTime() + 30 * 60_000));
    }
    clamped.push(candidate);
    prev = candidate;
  }
  return clamped;
}

function clampToDaytime(d: Date): Date {
  const k = toKinshasa(d);
  if (k.h < DAY_START_HOUR) {
    return fromKinshasa(k.y, k.m, k.d, 9, 0);
  }
  if (k.h >= DAY_END_HOUR) {
    return fromKinshasa(k.y, k.m, k.d + 1, 9, 0);
  }
  return d;
}

function renderEmail(opts: {
  name: string | null;
  orderId: string;
  totalUsd: number | null;
  attempt: number;
  lang: Lang;
}) {
  const { name, orderId, totalUsd, attempt, lang } = opts;
  const payUrl = `${SITE_URL}/orders/${orderId}?retry=1`;
  const amount = totalUsd != null ? `$${Number(totalUsd).toFixed(2)}` : '';
  const ref = orderId.slice(0, 8).toUpperCase();
  const hi = name
    ? lang === 'fr' ? `Bonjour ${name},` : `Hi ${name},`
    : lang === 'fr' ? 'Bonjour,' : 'Hi,';

  if (lang === 'fr') {
    const subject = attempt <= 3
      ? `Rappel : finalisez votre commande AfriShop ${amount}`
      : attempt <= 6
      ? `Votre commande AfriShop ${amount} est toujours en attente`
      : `Dernier rappel : votre commande AfriShop ${amount}`;
    return {
      subject,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
          <h2 style="margin:0 0 12px">${hi}</h2>
          <p>Votre commande ${amount ? `de <b>${amount}</b> ` : ''}est encore <b>en attente de paiement</b>. Quelques secondes suffisent pour la finaliser :</p>
          <ul style="padding-left:18px;color:#333">
            <li>💳 Carte bancaire (Visa/Mastercard)</li>
            <li>📱 Mobile Money (Airtel Money, M-Pesa, Orange Money)</li>
            <li>🧾 Ou option acompte 30% maintenant / 70% à la livraison</li>
          </ul>
          <p style="text-align:center;margin:28px 0">
            <a href="${payUrl}" style="background:#16a34a;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Finaliser mon paiement</a>
          </p>
          <p style="font-size:13px;color:#555">Besoin d'aide ? Répondez à cet email ou écrivez-nous sur WhatsApp au +243 973 141 627.</p>
          <p style="font-size:12px;color:#999;margin-top:24px">Référence : ${ref}</p>
        </div>`,
    };
  }

  const subject = attempt <= 3
    ? `Reminder: complete your AfriShop order ${amount}`
    : attempt <= 6
    ? `Your AfriShop order ${amount} is still pending`
    : `Last reminder: your AfriShop order ${amount}`;
  return {
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111">
        <h2 style="margin:0 0 12px">${hi}</h2>
        <p>Your order ${amount ? `of <b>${amount}</b> ` : ''}is still <b>pending payment</b>. It only takes a few seconds to finish:</p>
        <ul style="padding-left:18px;color:#333">
          <li>💳 Credit/debit card (Visa/Mastercard)</li>
          <li>📱 Mobile Money (Airtel Money, M-Pesa, Orange Money)</li>
          <li>🧾 Or pay 30% now / 70% on delivery</li>
        </ul>
        <p style="text-align:center;margin:28px 0">
          <a href="${payUrl}" style="background:#16a34a;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Complete my payment</a>
        </p>
        <p style="font-size:13px;color:#555">Need help? Reply to this email or message us on WhatsApp at +243 973 141 627.</p>
        <p style="font-size:12px;color:#999;margin-top:24px">Order ref: ${ref}</p>
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

  const now = new Date();
  // Window: orders created within last 6 days (covers day +5 + grace)
  const windowStart = new Date(now.getTime() - 6 * 24 * 3600_000).toISOString();

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, user_id, total_usd, created_at, profiles:profiles!orders_user_id_fkey(email, full_name, name, language)')
    .eq('status', 'PENDING_PAYMENT')
    .gte('created_at', windowStart)
    .limit(200);

  if (error) {
    console.error('[pending-reminders] orders query error', error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let sent = 0, skipped = 0, failed = 0;

  for (const o of orders ?? []) {
    const email: string | null = o.customer_email ?? null;
    if (!email) { skipped++; continue; }

    const slots = computeSlots(new Date(o.created_at));

    // Which attempts are already sent?
    const { data: alreadySent } = await supabase
      .from('payment_pending_reminders')
      .select('attempt_number')
      .eq('order_id', o.id);
    const sentSet = new Set((alreadySent ?? []).map((r: any) => r.attempt_number));

    for (let i = 0; i < slots.length; i++) {
      const attempt = i + 1;
      if (sentSet.has(attempt)) continue;
      if (slots[i].getTime() > now.getTime()) break; // not due yet; later attempts also future

      const lang: Lang = (o.language === 'en' ? 'en' : 'fr');
      const { subject, html } = renderEmail({
        name: o.customer_name ?? null,
        orderId: o.id,
        totalUsd: o.total_usd ?? null,
        attempt,
        lang,
      });

      try {
        await sendEmail({
          to: email,
          subject,
          html,
          category: 'cart_recovery',
        });

        const { error: logErr } = await supabase
          .from('payment_pending_reminders')
          .insert({
            order_id: o.id,
            attempt_number: attempt,
            scheduled_for: slots[i].toISOString(),
            channel: 'email',
          });
        if (logErr) console.error('[pending-reminders] log insert error', logErr);
        sent++;
      } catch (e) {
        failed++;
        console.error('[pending-reminders] send failed', o.id, attempt, e);
        await supabase.from('payment_pending_reminders').insert({
          order_id: o.id,
          attempt_number: attempt,
          scheduled_for: slots[i].toISOString(),
          channel: 'email',
          error: String((e as Error)?.message || e).slice(0, 500),
        });
        break; // don't keep hammering same order this cycle
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, scanned: orders?.length ?? 0, sent, skipped, failed }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
