/**
 * Referral Commission Helper
 * 
 * Called after a payment is confirmed (order marked PAID).
 * Looks up the buyer's referral code, finds the referrer, calculates commission,
 * inserts a row into referral_commissions, sends notification email,
 * and optionally triggers auto-payout.
 * 
 * Idempotent: uses (order_id, referrer_id) unique constraint.
 */

import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Send commission notification email to referrer via email-service
 */
async function sendCommissionNotificationEmail(
  supabase: SupabaseClient,
  referrer: { full_name: string; email: string; ref_code: string },
  commissionAmount: number,
  orderTotalUsd: number,
  commissionPercent: number,
  source: string
): Promise<void> {
  try {
    if (!referrer.email) {
      console.log(`[${source}] [REFERRAL_EMAIL] No email for referrer, skipping`);
      return;
    }

    // Calculate running total for this referrer
    const { data: allCommissions } = await supabase
      .from('referral_commissions')
      .select('commission_amount_usd')
      .eq('status', 'pending');

    // Note: we include the one we just inserted
    const pendingTotal = (allCommissions || []).reduce(
      (sum: number, c: any) => sum + (c.commission_amount_usd || 0), 0
    );

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';

    // Call email-service directly via fetch
    const emailBody = {
      action: 'send',
      to: referrer.email,
      subject: `🎉 Commission gagnée ! / Commission earned!`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #16a34a;">🎉 Félicitations ${referrer.full_name} !</h2>
          <p>Quelqu'un que vous avez parrainé vient de faire un achat !</p>
          <div style="background: #f0fdf4; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>Total de la commande :</strong> $${orderTotalUsd.toFixed(2)}</p>
            <p style="margin: 4px 0;"><strong>Votre commission (${commissionPercent}%) :</strong> <span style="color: #16a34a; font-size: 1.2em; font-weight: bold;">$${commissionAmount.toFixed(2)}</span></p>
            <p style="margin: 4px 0;"><strong>Solde en attente :</strong> $${pendingTotal.toFixed(2)}</p>
          </div>
          <p style="color: #6b7280; font-size: 0.9em;">Continuez à partager votre code <strong>${referrer.ref_code}</strong> pour gagner plus !</p>
          
          <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;" />
          
          <h2 style="color: #16a34a;">🎉 Congratulations ${referrer.full_name}!</h2>
          <p>Someone you referred just made a purchase!</p>
          <div style="background: #f0fdf4; border-radius: 8px; padding: 16px; margin: 16px 0;">
            <p style="margin: 4px 0;"><strong>Order total:</strong> $${orderTotalUsd.toFixed(2)}</p>
            <p style="margin: 4px 0;"><strong>Your commission (${commissionPercent}%):</strong> <span style="color: #16a34a; font-size: 1.2em; font-weight: bold;">$${commissionAmount.toFixed(2)}</span></p>
            <p style="margin: 4px 0;"><strong>Pending balance:</strong> $${pendingTotal.toFixed(2)}</p>
          </div>
          <p style="color: #6b7280; font-size: 0.9em;">Keep sharing your code <strong>${referrer.ref_code}</strong> to earn more!</p>
        </div>
      `,
    };

    const emailRes = await fetch(`${supabaseUrl}/functions/v1/email-service`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify(emailBody),
    });

    if (emailRes.ok) {
      console.log(`[${source}] [REFERRAL_EMAIL] Notification sent to ${referrer.email}`);
    } else {
      console.warn(`[${source}] [REFERRAL_EMAIL] Email send failed: ${emailRes.status}`);
    }
  } catch (err: any) {
    console.error(`[${source}] [REFERRAL_EMAIL] Error:`, err.message);
  }
}

/**
 * Trigger auto-payout if mode is automatic
 */
async function triggerAutoPayoutIfEnabled(
  supabase: SupabaseClient,
  referrerId: string,
  source: string
): Promise<void> {
  try {
    const { data: modeSetting } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'REFERRAL_PAYOUT_MODE')
      .maybeSingle();

    if (modeSetting?.value !== 'automatic') {
      console.log(`[${source}] [REFERRAL_PAYOUT] Payout mode is manual, skipping auto-payout`);
      return;
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';

    const res = await fetch(`${supabaseUrl}/functions/v1/referral-payout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({ action: 'process', referrer_id: referrerId }),
    });

    const result = await res.json();
    console.log(`[${source}] [REFERRAL_PAYOUT] Auto-payout result:`, result);
  } catch (err: any) {
    console.error(`[${source}] [REFERRAL_PAYOUT] Auto-payout error:`, err.message);
  }
}

export async function createReferralCommission(
  supabase: SupabaseClient,
  orderId: string,
  buyerUserId: string,
  orderTotalUsd: number,
  source: string
): Promise<void> {
  try {
    if (!orderId || !buyerUserId || !orderTotalUsd || orderTotalUsd <= 0) {
      console.log(`[${source}] [REFERRAL_COMMISSION] Skipping — missing data`, { orderId, buyerUserId, orderTotalUsd });
      return;
    }

    // 1. Look up buyer's referred_by_code
    const { data: profile } = await supabase
      .from('profiles')
      .select('referred_by_code')
      .eq('user_id', buyerUserId)
      .maybeSingle();

    if (!profile?.referred_by_code) {
      console.log(`[${source}] [REFERRAL_COMMISSION] Buyer has no referral code`, { buyerUserId });
      return;
    }

    const refCode = profile.referred_by_code;

    // 2. Find the referrer
    const { data: referrer } = await supabase
      .from('referrers')
      .select('id, full_name, email, ref_code')
      .eq('ref_code', refCode)
      .eq('status', 'active')
      .maybeSingle();

    if (!referrer) {
      console.log(`[${source}] [REFERRAL_COMMISSION] Referrer not found or inactive for code:`, refCode);
      return;
    }

    // 3. Get commission percentage from admin_settings
    const { data: setting } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'REFERRAL_COMMISSION_PERCENT')
      .maybeSingle();

    const commissionPercent = parseFloat(setting?.value || '10');
    if (isNaN(commissionPercent) || commissionPercent <= 0) {
      console.log(`[${source}] [REFERRAL_COMMISSION] Commission percent is 0 or invalid, skipping`);
      return;
    }

    const commissionAmount = Math.round(orderTotalUsd * commissionPercent) / 100;

    // 4. Insert commission (idempotent via unique constraint)
    const { error } = await supabase
      .from('referral_commissions')
      .insert({
        referrer_id: referrer.id,
        order_id: orderId,
        buyer_user_id: buyerUserId,
        order_total_usd: orderTotalUsd,
        commission_percent: commissionPercent,
        commission_amount_usd: commissionAmount,
        status: 'pending',
      });

    if (error) {
      if (error.code === '23505') {
        console.log(`[${source}] [REFERRAL_COMMISSION] Already exists for order`, { orderId });
      } else {
        console.error(`[${source}] [REFERRAL_COMMISSION] Insert error:`, error.message);
      }
      return; // Don't send email or payout on duplicate/error
    }

    console.log(`[${source}] [REFERRAL_COMMISSION] Created`, {
      orderId,
      referrerId: referrer.id,
      refCode,
      commissionPercent,
      commissionAmount,
    });

    // Log referral event
    await supabase.from('referral_events').insert({
      ref_code: refCode,
      event_type: 'purchase',
      referred_user_id: buyerUserId,
      metadata: { order_id: orderId, order_total_usd: orderTotalUsd, commission_amount_usd: commissionAmount },
    }).then(() => {}).catch(() => {});

    // 5. Send notification email to referrer (fire-and-forget)
    sendCommissionNotificationEmail(
      supabase,
      { full_name: referrer.full_name, email: referrer.email, ref_code: referrer.ref_code },
      commissionAmount,
      orderTotalUsd,
      commissionPercent,
      source
    ).catch(() => {});

    // 6. Trigger auto-payout if enabled (fire-and-forget)
    triggerAutoPayoutIfEnabled(supabase, referrer.id, source).catch(() => {});

  } catch (err: any) {
    console.error(`[${source}] [REFERRAL_COMMISSION] Error:`, err.message);
  }
}
