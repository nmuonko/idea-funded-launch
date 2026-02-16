import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1?pin=v135";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cache token in memory (edge function instance lifespan)
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getReloadlyToken(isSandbox: boolean): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const clientId = Deno.env.get('RELOADLY_CLIENT_ID');
  const clientSecret = Deno.env.get('RELOADLY_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new Error('Reloadly credentials not configured');

  const audience = isSandbox
    ? 'https://topups-sandbox.reloadly.com'
    : 'https://topups.reloadly.com';

  const res = await fetch('https://auth.reloadly.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      audience,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Reloadly auth failed: ${res.status} ${errText}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000, // 1 min buffer
  };
  return cachedToken.token;
}

function getBaseUrl(isSandbox: boolean): string {
  return isSandbox
    ? 'https://topups-sandbox.reloadly.com'
    : 'https://topups.reloadly.com';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      phone,
      countryCode = 'CD',
      topupType = 'data', // 'data' or 'airtime'
      amount, // airtime amount in local currency
      dataMb, // data bundle size in MB
      claimId,
      referrerId,
    } = await req.json();

    if (!phone || !referrerId) {
      return new Response(JSON.stringify({ ok: false, error: 'phone and referrerId required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const isSandbox = Deno.env.get('RELOADLY_SANDBOX') === 'true';
    const baseUrl = getBaseUrl(isSandbox);
    const token = await getReloadlyToken(isSandbox);
    const authHeaders = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/com.reloadly.topups-v1+json',
    };

    // Supabase admin client for logging
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Auto-detect operator
    console.log(`[reloadly-topup] Auto-detecting operator for ${phone} in ${countryCode}`);
    const detectRes = await fetch(
      `${baseUrl}/operators/auto-detect/phone/${encodeURIComponent(phone)}/countries/${countryCode}`,
      { headers: authHeaders }
    );

    if (!detectRes.ok) {
      const errText = await detectRes.text();
      console.error(`[reloadly-topup] Operator detect failed: ${detectRes.status} ${errText}`);

      // Log failure
      await supabaseAdmin.from('referral_topup_log').insert({
        claim_id: claimId || null,
        referrer_id: referrerId,
        phone,
        topup_type: topupType,
        amount: amount || null,
        data_mb: dataMb || null,
        country_code: countryCode,
        status: 'failed',
        error_message: `Operator detection failed: ${detectRes.status}`,
      });

      return new Response(JSON.stringify({ ok: false, error: 'OPERATOR_DETECT_FAILED' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const operator = await detectRes.json();
    console.log(`[reloadly-topup] Operator detected: ${operator.name} (ID: ${operator.operatorId})`);

    // 2. Send top-up
    const topupAmount = topupType === 'airtime' ? amount : (dataMb || amount || 1);
    const topupBody: Record<string, unknown> = {
      operatorId: operator.operatorId,
      amount: topupAmount,
      useLocalAmount: true,
      recipientPhone: { countryCode, number: phone },
    };

    console.log(`[reloadly-topup] Sending ${topupType} topup:`, JSON.stringify(topupBody));
    const topupRes = await fetch(`${baseUrl}/topups`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(topupBody),
    });

    const topupData = await topupRes.json();

    if (!topupRes.ok) {
      console.error(`[reloadly-topup] Topup failed: ${topupRes.status}`, JSON.stringify(topupData));

      await supabaseAdmin.from('referral_topup_log').insert({
        claim_id: claimId || null,
        referrer_id: referrerId,
        phone,
        operator_name: operator.name,
        operator_id: String(operator.operatorId),
        topup_type: topupType,
        amount: topupAmount,
        data_mb: dataMb || null,
        country_code: countryCode,
        status: 'failed',
        error_message: topupData.message || `Topup failed: ${topupRes.status}`,
        raw_response: topupData,
      });

      // Update claim if provided
      if (claimId) {
        await supabaseAdmin.from('referral_payout_claims').update({
          delivery_status: 'delivery_failed',
          delivery_error: topupData.message || 'Topup failed',
        }).eq('id', claimId);
      }

      return new Response(JSON.stringify({ ok: false, error: 'TOPUP_FAILED', message: topupData.message }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Success — log and update claim
    const txId = String(topupData.transactionId || topupData.customIdentifier || '');
    console.log(`[reloadly-topup] Success! TX: ${txId}`);

    await supabaseAdmin.from('referral_topup_log').insert({
      claim_id: claimId || null,
      referrer_id: referrerId,
      phone,
      operator_name: operator.name,
      operator_id: String(operator.operatorId),
      topup_type: topupType,
      amount: topupAmount,
      data_mb: dataMb || null,
      reloadly_tx_id: txId,
      country_code: countryCode,
      status: 'success',
      raw_response: topupData,
    });

    if (claimId) {
      await supabaseAdmin.from('referral_payout_claims').update({
        delivery_status: 'delivered',
        delivery_tx_id: txId,
        delivery_error: null,
      }).eq('id', claimId);
    }

    return new Response(JSON.stringify({
      ok: true,
      transactionId: txId,
      operator: operator.name,
      amount: topupAmount,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('[reloadly-topup] Error:', error.message);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
