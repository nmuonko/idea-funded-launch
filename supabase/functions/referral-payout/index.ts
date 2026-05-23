/**
 * referral-payout Edge Function
 * 
 * Executes mobile money payouts to referrers via PawaPay.
 * Called automatically (if mode=automatic) or by admin click (mode=manual).
 * 
 * Actions:
 *   - process: Aggregate pending commissions for a referrer and send payout
 *   - process_all: Process all referrers with pending balances above threshold
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createAdminClient } from "../_shared/auth.ts";
import { requireAdminOrCron, guardErrorResponse } from "../_shared/securityGuards.ts";
import { getPawaPayConfig, detectCorrespondent, formatPhoneE164 } from "../_shared/pawapayAdapter.ts";
import { generateDepositId } from "../_shared/paymentProviders.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Execute a payout to a single referrer
 */
async function executePayoutForReferrer(
  supabase: any,
  referrerId: string,
  minPayoutUsd: number
): Promise<{ success: boolean; message: string; payoutId?: string }> {
  const TAG = '[REFERRAL_PAYOUT]';

  // 1. Get referrer details
  const { data: referrer } = await supabase
    .from('referrers')
    .select('id, full_name, phone, email, status')
    .eq('id', referrerId)
    .eq('status', 'active')
    .maybeSingle();

  if (!referrer) {
    return { success: false, message: 'Referrer not found or inactive' };
  }

  if (!referrer.phone) {
    return { success: false, message: 'Referrer has no phone number' };
  }

  // 2. Get all pending commissions
  const { data: pendingCommissions } = await supabase
    .from('referral_commissions')
    .select('id, commission_amount_usd')
    .eq('referrer_id', referrerId)
    .eq('status', 'pending');

  if (!pendingCommissions || pendingCommissions.length === 0) {
    return { success: false, message: 'No pending commissions' };
  }

  const totalAmount = pendingCommissions.reduce(
    (sum: number, c: any) => sum + (c.commission_amount_usd || 0), 0
  );
  const roundedAmount = Math.round(totalAmount * 100) / 100;

  if (roundedAmount < minPayoutUsd) {
    return { success: false, message: `Balance $${roundedAmount} below minimum $${minPayoutUsd}` };
  }

  const commissionIds = pendingCommissions.map((c: any) => c.id);

  // 3. Prepare PawaPay payout
  const phoneE164 = formatPhoneE164(referrer.phone);
  const correspondent = detectCorrespondent(referrer.phone);
  const payoutId = generateDepositId(); // Reuse UUID generator

  console.log(`${TAG} Executing payout:`, {
    referrerId,
    referrerName: referrer.full_name,
    phone_last4: phoneE164.slice(-4),
    correspondent,
    amount: roundedAmount,
    commissionCount: commissionIds.length,
    payoutId,
  });

  // 4. Insert payout record (optimistic)
  const { error: insertError } = await supabase.from('referral_payouts').insert({
    referrer_id: referrerId,
    amount_usd: roundedAmount,
    phone: phoneE164,
    correspondent,
    pawapay_payout_id: payoutId,
    status: 'pending',
    commission_ids: commissionIds,
  });

  if (insertError) {
    console.error(`${TAG} Failed to insert payout record:`, insertError.message);
    return { success: false, message: 'Failed to create payout record' };
  }

  // 5. Mark commissions as processing
  await supabase
    .from('referral_commissions')
    .update({ status: 'processing' })
    .in('id', commissionIds);

  // 6. Call PawaPay payout API
  try {
    const config = getPawaPayConfig();

    const payoutRequest = {
      payoutId,
      amount: roundedAmount.toFixed(2),
      currency: 'USD',
      correspondent,
      recipient: {
        type: 'MSISDN',
        address: { value: phoneE164 },
      },
      customerTimestamp: new Date().toISOString(),
      statementDescription: 'AFRISHOP-COMMISSION',
      metadata: [
        { fieldName: 'app', fieldValue: 'afrishop' },
        { fieldName: 'referrer_id', fieldValue: referrerId },
      ],
    };

    console.log(`${TAG} Sending PawaPay payout request:`, {
      payoutId,
      amount: payoutRequest.amount,
      correspondent,
    });

    const response = await fetch(`${config.apiBase}/payouts`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payoutRequest),
    });

    const responseData = await response.json();

    if (responseData.status === 'ACCEPTED' || responseData.status === 'DUPLICATE_IGNORED') {
      console.log(`${TAG} PawaPay payout ACCEPTED:`, { payoutId });

      // Update payout record status
      await supabase
        .from('referral_payouts')
        .update({ status: 'sent' })
        .eq('pawapay_payout_id', payoutId);

      return { success: true, message: 'Payout sent', payoutId };
    } else {
      // Rejected
      const reason = responseData.rejectionReason?.rejectionMessage || 'Rejected by provider';
      console.error(`${TAG} PawaPay payout REJECTED:`, { payoutId, reason });

      // Revert
      await supabase
        .from('referral_payouts')
        .update({ status: 'failed', failure_reason: reason })
        .eq('pawapay_payout_id', payoutId);

      await supabase
        .from('referral_commissions')
        .update({ status: 'pending' })
        .in('id', commissionIds);

      return { success: false, message: reason, payoutId };
    }
  } catch (err: any) {
    console.error(`${TAG} PawaPay API error:`, err.message);

    // Revert on network error
    await supabase
      .from('referral_payouts')
      .update({ status: 'failed', failure_reason: err.message })
      .eq('pawapay_payout_id', payoutId);

    await supabase
      .from('referral_commissions')
      .update({ status: 'pending' })
      .in('id', commissionIds);

    return { success: false, message: 'PawaPay API error: ' + err.message, payoutId };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    try { await requireAdminOrCron(req); } catch (e) { return guardErrorResponse(e, corsHeaders); }
    const supabase = createAdminClient();
    const body = await req.json();
    const action = body.action || 'process';

    // Get payout settings
    const { data: modeRow } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'REFERRAL_PAYOUT_MODE')
      .maybeSingle();
    const { data: minRow } = await supabase
      .from('admin_settings')
      .select('value')
      .eq('key', 'REFERRAL_PAYOUT_MIN_USD')
      .maybeSingle();

    const minPayoutUsd = parseFloat(minRow?.value || '5');

    if (action === 'process') {
      // Process a single referrer
      const referrerId = body.referrer_id;
      if (!referrerId) {
        return new Response(JSON.stringify({ error: 'referrer_id required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const result = await executePayoutForReferrer(supabase, referrerId, minPayoutUsd);
      return new Response(JSON.stringify(result), {
        status: result.success ? 200 : 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'process_all') {
      // Process all eligible referrers (used by automatic mode)
      const { data: eligible } = await supabase
        .from('referral_commissions')
        .select('referrer_id')
        .eq('status', 'pending');

      const uniqueReferrerIds = [...new Set((eligible || []).map((c: any) => c.referrer_id))];
      const results: any[] = [];

      for (const rid of uniqueReferrerIds) {
        const result = await executePayoutForReferrer(supabase, rid, minPayoutUsd);
        results.push({ referrer_id: rid, ...result });
      }

      return new Response(JSON.stringify({ processed: results.length, results }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('[REFERRAL_PAYOUT] Error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
