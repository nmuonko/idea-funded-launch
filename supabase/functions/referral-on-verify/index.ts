import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1?pin=v135";
import { sendEmail } from "../_shared/email.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { userId } = await req.json();
    if (!userId) {
      return new Response(JSON.stringify({ ok: false, message: 'userId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Get the user's referred_by_code
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('referred_by_code, user_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!profile?.referred_by_code) {
      console.log('[referral-on-verify] No referral code for user:', userId);
      return new Response(JSON.stringify({ ok: true, rewarded: false, reason: 'no_referral' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const refCode = profile.referred_by_code;

    // 2. Resolve referrer from referrers table
    const { data: referrer } = await supabaseAdmin
      .from('referrers')
      .select('id, full_name, email, status')
      .eq('ref_code', refCode)
      .maybeSingle();

    if (!referrer || referrer.status !== 'active') {
      console.log('[referral-on-verify] Referrer not found or inactive:', refCode);
      return new Response(JSON.stringify({ ok: true, rewarded: false, reason: 'referrer_not_found' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Create reward (idempotent via unique referred_user_id)
    const { error: rewardError } = await supabaseAdmin
      .from('referral_rewards')
      .insert({
        referrer_id: referrer.id,
        referred_user_id: userId,
        ref_code: refCode,
        status: 'pending',
      });

    if (rewardError) {
      if (rewardError.code === '23505') {
        console.log('[referral-on-verify] Reward already exists for:', userId);
        return new Response(JSON.stringify({ ok: true, rewarded: false, reason: 'already_rewarded' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.error('[referral-on-verify] Reward insert error:', rewardError);
      throw rewardError;
    }

    // 4. Log verified event
    await supabaseAdmin.from('referral_events').insert({
      ref_code: refCode,
      event_type: 'verified',
      user_id: userId,
      meta: { referrer_id: referrer.id },
    });

    console.log('[referral-on-verify] Reward created for referrer:', referrer.id, 'from:', userId);

    // 5. Check payout thresholds
    try {
      // Count verified rewards for this ref_code
      const { count: verifiedCount } = await supabaseAdmin
        .from('referral_rewards')
        .select('*', { count: 'exact', head: true })
        .eq('ref_code', refCode);

      const currentCount = verifiedCount || 0;

      // Get all enabled rules
      const { data: rules } = await supabaseAdmin
        .from('referral_payout_rules')
        .select('*')
        .eq('is_enabled', true);

      if (rules && rules.length > 0) {
        for (const rule of rules) {
          if (currentCount >= rule.threshold_verified_count) {
            // Check if claim already exists
            const { data: existingClaim } = await supabaseAdmin
              .from('referral_payout_claims')
              .select('id')
              .eq('referrer_id', referrer.id)
              .eq('rule_id', rule.id)
              .maybeSingle();

            if (!existingClaim) {
              // Create payout claim
              await supabaseAdmin.from('referral_payout_claims').insert({
                referrer_id: referrer.id,
                ref_code: refCode,
                rule_id: rule.id,
                verified_count_at_trigger: currentCount,
                payout_amount_usd: rule.payout_amount_usd,
                status: 'pending',
              });

              // Create admin in-app notification
              const notifBody = `${referrer.full_name} (${refCode}) reached ${currentCount} verified signups. Payout $${rule.payout_amount_usd}.`;
              await supabaseAdmin.from('admin_notifications').insert({
                type: 'REFERRER_THRESHOLD_REACHED',
                title: 'Referrer reached payout threshold',
                body: notifBody,
                payload: {
                  referrer_id: referrer.id,
                  ref_code: refCode,
                  verified_count: currentCount,
                  threshold: rule.threshold_verified_count,
                  payout_amount_usd: rule.payout_amount_usd,
                },
              });

              // Send admin email alert
              try {
                const { data: alertSetting } = await supabaseAdmin
                  .from('admin_settings')
                  .select('value')
                  .eq('key', 'ADMIN_ALERT_EMAIL')
                  .maybeSingle();

                if (alertSetting?.value) {
                  await sendEmail({
                    to: alertSetting.value,
                    subject: `AfriShop referral payout reached: ${refCode}`,
                    html: `
                      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                        <h2 style="color: #f97316;">Referral Payout Threshold Reached</h2>
                        <p><strong>${referrer.full_name}</strong> (${refCode}) has reached <strong>${currentCount}</strong> verified signups.</p>
                        <p>Payout amount: <strong>$${rule.payout_amount_usd}</strong></p>
                        <p>Threshold: ${rule.threshold_verified_count} verified signups</p>
                        <p>Please process the payout in the admin dashboard.</p>
                        <a href="https://afrishop-usa.com/admin/referrals" style="display:inline-block;background:#f97316;color:white;padding:10px 20px;text-decoration:none;border-radius:6px;margin-top:10px;">View Referrals Dashboard</a>
                      </div>
                    `,
                    category: 'admin_notification',
                  });
                  console.log('[referral-on-verify] Admin email sent to:', alertSetting.value);
                }
              } catch (emailErr: any) {
                console.warn('[referral-on-verify] Admin email failed (non-fatal):', emailErr.message);
              }

              console.log('[referral-on-verify] Payout claim created for rule:', rule.id, 'referrer:', referrer.id);
            }
          }
        }
      }

      // Also check legacy marketer_thresholds
      const { data: threshold } = await supabaseAdmin
        .from('marketer_thresholds')
        .select('*')
        .eq('ref_code', refCode)
        .eq('is_enabled', true)
        .maybeSingle();

      if (threshold) {
        const alreadyNotified = (threshold.last_notified_count || 0) >= threshold.threshold_count;
        if (currentCount >= threshold.threshold_count && !alreadyNotified) {
          await supabaseAdmin.from('admin_notifications').insert({
            type: 'MARKETER_THRESHOLD_REACHED',
            title: 'Marketer target reached',
            body: `${threshold.marketer_name} (${refCode}) reached ${currentCount} verified signups (target ${threshold.threshold_count}).`,
            payload: { ref_code: refCode, marketer_name: threshold.marketer_name, threshold_count: threshold.threshold_count, verified_count: currentCount },
          });
          await supabaseAdmin
            .from('marketer_thresholds')
            .update({ last_notified_count: currentCount, notified_at: new Date().toISOString() })
            .eq('id', threshold.id);
        }
      }
    } catch (threshErr: any) {
      console.error('[referral-on-verify] Threshold/payout check error (non-fatal):', threshErr.message);
    }

    return new Response(JSON.stringify({ ok: true, rewarded: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[referral-on-verify] Error:', error.message);
    return new Response(JSON.stringify({ ok: false, message: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
