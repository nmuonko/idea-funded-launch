import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1?pin=v135";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Referral reward on email verification.
 * Called by the auth-check-verified or email-confirmed flow after a user's email is confirmed.
 * 
 * Body: { userId: string }
 * 
 * Logic:
 * 1. Look up profiles.referred_by_code for this user
 * 2. If exists, resolve referrer via referral_codes table
 * 3. Create referral_rewards row (idempotent via unique referred_user_id)
 * 4. Log referral_event type='email_verified'
 */

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

    // 2. Resolve referrer
    const { data: codeRow } = await supabaseAdmin
      .from('referral_codes')
      .select('user_id')
      .eq('code', refCode)
      .maybeSingle();

    if (!codeRow) {
      console.log('[referral-on-verify] Referral code not found:', refCode);
      return new Response(JSON.stringify({ ok: true, rewarded: false, reason: 'code_not_found' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const referrerUserId = codeRow.user_id;

    // 3. Anti-abuse: self-referral check
    if (referrerUserId === userId) {
      console.log('[referral-on-verify] Self-referral blocked:', userId);
      return new Response(JSON.stringify({ ok: true, rewarded: false, reason: 'self_referral' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 4. Create reward (idempotent - unique constraint on referred_user_id)
    const { error: rewardError } = await supabaseAdmin
      .from('referral_rewards')
      .insert({
        referrer_user_id: referrerUserId,
        referred_user_id: userId,
        ref_code: refCode,
        amount_usd: 0, // admin sets actual amount later
        reward_type: 'credit',
        status: 'pending',
      });

    if (rewardError) {
      if (rewardError.code === '23505') { // unique violation = already rewarded
        console.log('[referral-on-verify] Reward already exists for referred user:', userId);
        return new Response(JSON.stringify({ ok: true, rewarded: false, reason: 'already_rewarded' }), {
          status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      console.error('[referral-on-verify] Reward insert error:', rewardError);
      throw rewardError;
    }

    // 5. Log event
    await supabaseAdmin.from('referral_events').insert({
      ref_code: refCode,
      event_type: 'email_verified',
      referred_user_id: userId,
      metadata: { referrer_user_id: referrerUserId },
    });

    console.log('[referral-on-verify] Reward created for referrer:', referrerUserId, 'from referred:', userId);

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
