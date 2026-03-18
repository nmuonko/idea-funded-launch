/**
 * Referral Commission Helper
 * 
 * Called after a payment is confirmed (order marked PAID).
 * Looks up the buyer's referral code, finds the referrer, calculates commission,
 * and inserts a row into referral_commissions.
 * 
 * Idempotent: uses (order_id, referrer_id) unique constraint.
 */

import { SupabaseClient } from "@supabase/supabase-js";

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
      .select('id')
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
        // Unique constraint violation — already exists
        console.log(`[${source}] [REFERRAL_COMMISSION] Already exists for order`, { orderId });
      } else {
        console.error(`[${source}] [REFERRAL_COMMISSION] Insert error:`, error.message);
      }
    } else {
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
    }
  } catch (err: any) {
    console.error(`[${source}] [REFERRAL_COMMISSION] Error:`, err.message);
  }
}
