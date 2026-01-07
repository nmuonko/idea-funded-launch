import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { 
  getActiveProvider, 
  createPaymentRecord,
  generatePaymentReference,
  validateProviderSecrets,
} from "../_shared/paymentProviders.ts";
import { createDeposit, getPawaPayConfig } from "../_shared/pawapayAdapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Payment limits - DO NOT CHANGE
const USD_LIMIT = 5000;
const CDF_LIMIT = 30000000;

serve(async (req) => {
  // Generate request ID for tracing
  const requestId = crypto.randomUUID();
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1️⃣ Parse request JSON body for forceCurrency and shippingCity
    const body = await req.json().catch(() => ({}));
    const forceCurrency: 'USD' | 'CDF' | null = body.forceCurrency || null;
    const shippingCity: string | null = body.shippingCity || null;
    const paymentMethod: string = body.payment_method || body.method || 'MOBILE_MONEY';
    const country: string = body.country || 'COD';

    console.log(`[${requestId}] Request body:`, { forceCurrency, shippingCity, paymentMethod, country });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    // 2️⃣ Auth
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.log(`[${requestId}] AUTH FAILED:`, userError?.message);
      return new Response(JSON.stringify({ success: false, error: "Unauthorized", requestId }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[${requestId}] AUTH OK: user=${user.id}`);

    // 3️⃣ Extract orderId from URL path
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter((p) => p);
    const orderId = pathParts[pathParts.length - 1];

    if (!orderId) {
      console.log(`[${requestId}] MISSING ORDER ID`);
      return new Response(JSON.stringify({ success: false, error: "Order ID required", requestId }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[${requestId}] ORDER LOAD: orderId=${orderId}, userId=${user.id}`);

    // 4️⃣ Load order
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .eq("user_id", user.id)
      .single();

    if (orderError || !order) {
      console.error(`[${requestId}] ORDER NOT FOUND:`, orderError?.message);
      return new Response(JSON.stringify({ success: false, error: "Order not found", requestId }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (order.status !== "PENDING_PAYMENT") {
      console.log(`[${requestId}] INVALID STATUS: ${order.status}`);
      return new Response(JSON.stringify({ success: false, error: "Order cannot be paid", code: "INVALID_STATUS", requestId }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[${requestId}] ORDER LOADED: status=${order.status}, total_usd=${order.total_usd}`);

    // 4.5️⃣ Check for pending price confirmations (case-insensitive)
    const { data: orderItems, error: itemsError } = await supabase
      .from("order_items")
      .select("id, title, product_url, price_confirmation_status, is_saved_for_later")
      .eq("order_id", orderId)
      .eq("is_saved_for_later", false);

    if (itemsError) {
      console.error(`[${requestId}] ITEMS FETCH ERROR:`, itemsError.message);
    }

    const pendingPriceItems = (orderItems || []).filter(item => {
      const rawStatus = String(item.price_confirmation_status || '').toUpperCase().trim();
      return rawStatus === 'PENDING';
    });

    if (pendingPriceItems.length > 0) {
      console.log(`[${requestId}] PRICE_CONFIRMATION_REQUIRED:`, {
        pending_count: pendingPriceItems.length,
        pending_item_ids: pendingPriceItems.map(i => i.id),
      });

      return new Response(JSON.stringify({
        ok: false,
        success: false,
        code: 'PRICE_CONFIRMATION_REQUIRED',
        message_fr: "Un ou plusieurs articles ont un prix modifié en attente de vérification. Vous recevrez un e-mail après confirmation.",
        message_en: "One or more items have an edited price pending admin review. You'll receive an email once approved.",
        pendingItems: pendingPriceItems.map(item => ({
          id: item.id,
          name: item.title || 'Unknown item',
          url: item.product_url,
        })),
        requestId,
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5️⃣ Load profile for phone (guard against null)
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    // Customer contact info
    const customerPhone = profile
      ? (profile.phone ||
         (profile as any)?.phone_number ||
         (profile as any)?.phoneNumber ||
         (profile as any)?.phoneNumberFormatted ||
         "")
      : "";
    const customerEmail = user.email || "";

    // 6️⃣ Calculate totals for routing decision
    const totalUsd = Number(order.total_usd) || 0;
    
    // Validate totalUsd > 0
    if (totalUsd <= 0) {
      console.error(`[${requestId}] INVALID_AMOUNT: totalUsd=${totalUsd}`);
      return new Response(
        JSON.stringify({ 
          success: false,
          error: "Order has no valid amount",
          code: "INVALID_AMOUNT",
          totalUsd,
          requestId,
        }), 
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate and fallback exchange rate (must be finite and >= 1)
    let exchangeRate = Number(order.exchange_rate_used) || Number(order.exchange_rate) || 0;
    if (!Number.isFinite(exchangeRate) || exchangeRate < 1) {
      console.warn(`[${requestId}] EXCHANGE RATE FALLBACK: original=${exchangeRate}, using 2500`);
      exchangeRate = 2500;
    }

    const computedCdf = Math.round(totalUsd * exchangeRate);
    const orderCdf = Number(order.total_cdf);
    const resolvedOrderCdf = Number.isFinite(orderCdf) && orderCdf > 0 ? orderCdf : computedCdf;

    console.log(`[${requestId}] CDF RESOLUTION:`, { 
      totalUsd, 
      exchangeRate, 
      computedCdf, 
      orderCdf: order.total_cdf, 
      resolvedOrderCdf 
    });

    // RULE 2c: Block if exceeds all limits - BANK TRANSFER REQUIRED
    if (totalUsd > USD_LIMIT && computedCdf > CDF_LIMIT) {
      console.log(`[${requestId}] BLOCKED - BANK_TRANSFER_REQUIRED`);
      return new Response(
        JSON.stringify({
          success: false,
          code: 'BANK_TRANSFER_REQUIRED',
          totalUsd,
          cdfConverted: computedCdf,
          cap: CDF_LIMIT,
          message_fr: `Montant trop élevé (${computedCdf.toLocaleString()} CDF). Virement bancaire requis.`,
          message_en: `Amount too high (${computedCdf.toLocaleString()} CDF). Bank transfer required.`,
          requestId,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Determine currency & amount based on routing rules
    let paymentCurrency: 'USD' | 'CDF';
    let paymentAmount: number;
    let currencyReason: string;

    // RULE 2b: If USD > 5000 but CDF <= 30M, FORCE CDF (overrides forceCurrency)
    if (totalUsd > USD_LIMIT && computedCdf <= CDF_LIMIT) {
      paymentCurrency = 'CDF';
      paymentAmount = resolvedOrderCdf;
      currencyReason = 'FORCE_CDF_HIGH_USD';
    }
    // RULE 2a: USD within limit - respect forceCurrency
    else if (totalUsd <= USD_LIMIT) {
      if (forceCurrency === 'CDF') {
        paymentCurrency = 'CDF';
        paymentAmount = resolvedOrderCdf;
        currencyReason = 'FORCE_CURRENCY_CDF';
      } else if (forceCurrency === 'USD') {
        paymentCurrency = 'USD';
        paymentAmount = totalUsd;
        currencyReason = 'FORCE_CURRENCY_USD';
      } else {
        paymentCurrency = 'USD';
        paymentAmount = totalUsd;
        currencyReason = 'DEFAULT_USD';
      }
    } else {
      paymentCurrency = 'USD';
      paymentAmount = totalUsd;
      currencyReason = 'FALLBACK';
    }

    console.log(`[${requestId}] FINAL CURRENCY:`, {
      paymentCurrency,
      paymentAmount,
      forceCurrency,
      currencyReason,
    });

    // Validate final payment amount
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      console.error(`[${requestId}] INVALID FINAL AMOUNT:`, {
        paymentCurrency,
        paymentAmount,
        total_usd: order.total_usd,
        total_cdf: order.total_cdf,
        exchangeRate,
      });
      return new Response(
        JSON.stringify({ 
          success: false,
          error: "Invalid order amount",
          code: "INVALID_AMOUNT",
          requestId,
        }), 
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ==================== PROVIDER ROUTING ====================
    
    // Check if pawaPay is enabled and should be used
    const provider = await getActiveProvider(supabase, country, paymentMethod);
    
    console.log(`[${requestId}] Active provider:`, provider?.provider_key || 'none');

    if (provider && provider.provider_key === 'pawapay' && provider.is_enabled) {
      console.log(`[${requestId}] Routing to pawaPay`);
      
      const secretsValid = validateProviderSecrets(provider);
      if (!secretsValid.valid) {
        console.error(`[${requestId}] pawaPay secrets missing:`, secretsValid.missing);
        // Fall through to MaishaPay
      } else {
        try {
          const pawaConfig = getPawaPayConfig(provider);
          const reference = generatePaymentReference(orderId);
          
          const depositResult = await createDeposit(pawaConfig, {
            orderId,
            amount: paymentAmount,
            currency: paymentCurrency,
            customerPhone,
            customerEmail,
            country,
            reference,
            description: `AfriShop Order #${orderId.slice(0, 8)}`,
          });

          if (depositResult.success) {
            // Create payment record in unified payments table
            await createPaymentRecord(supabase, {
              order_id: orderId,
              provider_key: 'pawapay',
              amount: paymentAmount,
              currency: paymentCurrency,
              reference,
              customer_phone: customerPhone,
              country,
              provider_deposit_id: depositResult.provider_deposit_id,
              raw_request: depositResult.raw_request,
              status: 'pending',
            });

            // Update order with normalized currency audit
            const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
            if (serviceKey) {
              const adminSupabase = createClient(
                Deno.env.get("SUPABASE_URL") ?? "",
                serviceKey
              );
              await adminSupabase.from("orders").update({
                normalized_currency: paymentCurrency,
                normalized_amount: paymentAmount,
                exchange_rate_used: exchangeRate,
                maisha_payment_status: 'PENDING',
              }).eq("id", orderId);
            }

            console.log(`[${requestId}] pawaPay SUCCESS - Order:`, orderId);

            return new Response(
              JSON.stringify({
                success: true,
                checkoutUrl: null, // No URL for USSD push
                orderId,
                confirmationId: reference,
                provider: 'pawapay',
                payment_flow: 'USSD_PUSH',
                message: depositResult.message || 'Payment request sent to your phone',
                amount: paymentAmount,
                currency: paymentCurrency,
                requestId,
              }),
              {
                status: 200,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              }
            );
          } else {
            console.warn(`[${requestId}] pawaPay deposit failed, falling back to MaishaPay:`, depositResult.error);
          }
        } catch (pawaError: any) {
          console.error(`[${requestId}] pawaPay error, falling back to MaishaPay:`, pawaError.message);
        }
      }
    }

    // ==================== MAISHAPAY FALLBACK ====================

    // MaishaPay config
    const gatewayMode = Deno.env.get("MAISHAPAY_GATEWAY_MODE") || "1";
    const isLiveMode = gatewayMode === "1";

    const publicKey = isLiveMode
      ? Deno.env.get("MAISHAPAY_LIVE_PUBLIC_KEY") ||
        Deno.env.get("MAISHAPAY_PUBLIC_KEY")
      : Deno.env.get("MAISHAPAY_PUBLIC_KEY");

    const secretKey = isLiveMode
      ? Deno.env.get("MAISHAPAY_LIVE_SECRET_KEY") ||
        Deno.env.get("MAISHAPAY_SECRET_KEY")
      : Deno.env.get("MAISHAPAY_SECRET_KEY");

    const callbackUrl =
      Deno.env.get("MAISHAPAY_CALLBACK_URL") ||
      Deno.env.get("MAISHA_CALLBACK_URL");

    if (!publicKey || !secretKey || !callbackUrl) {
      console.error(`[${requestId}] MISSING MAISHAPAY CONFIG:`, {
        hasPublicKey: !!publicKey,
        hasSecretKey: !!secretKey,
        hasCallbackUrl: !!callbackUrl,
        gatewayMode,
        isLiveMode,
      });
      return new Response(
        JSON.stringify({ success: false, error: "MaishaPay not configured", requestId }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Update order with currency audit fields (safe guard for missing service key)
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (serviceKey) {
      try {
        const adminSupabase = createClient(
          Deno.env.get("SUPABASE_URL") ?? "",
          serviceKey
        );
        const { error: auditErr } = await adminSupabase.from("orders").update({
          normalized_currency: paymentCurrency,
          normalized_amount: paymentAmount,
          exchange_rate_used: exchangeRate,
        }).eq("id", orderId);
        
        if (auditErr) {
          console.warn(`[${requestId}] AUDIT UPDATE FAILED (non-blocking):`, auditErr.message);
        } else {
          console.log(`[${requestId}] AUDIT UPDATE OK`);
        }
      } catch (auditError: any) {
        console.warn(`[${requestId}] AUDIT UPDATE EXCEPTION (non-blocking):`, auditError.message);
      }
    } else {
      console.warn(`[${requestId}] SKIPPING AUDIT UPDATE: missing SUPABASE_SERVICE_ROLE_KEY`);
    }

    // Create unique reference
    const reference = `AFRISHOP-${orderId}-${Date.now()}`;

    console.log(`[${requestId}] PAYMENT DETAILS:`, {
      order_id: orderId,
      original_amount_usd: order.total_usd,
      original_amount_cdf: order.total_cdf,
      final_currency: paymentCurrency,
      final_amount: paymentAmount,
      exchange_rate: exchangeRate,
      currency_reason: currencyReason,
      reference,
    });

    // Prepare MaishaPay payload with phone fallbacks + null guard
    console.log(`[${requestId}] CUSTOMER CONTACT:`, { 
      email: user.email, 
      customerPhone: customerPhone ? "SET" : "EMPTY",
      hasProfile: !!profile 
    });

    const maishaPayload = {
      publicKey,
      amount: paymentAmount,
      currency: paymentCurrency,
      reference,
      customerEmail,
      customerPhone,
      description: `AfriShop order ${orderId}`,
      callbackUrl,
    };

    const maishaApiUrl = isLiveMode
      ? "https://marchand.maishapay.online/api/v1/transaction/create"
      : "https://sandbox.maishapay.online/api/v1/transaction/create";

    console.log(`[${requestId}] MAISHAPAY CALL:`, {
      url: maishaApiUrl,
      currency: paymentCurrency,
      amount: paymentAmount,
      isLiveMode,
    });

    // Call MaishaPay
    const maishaResponse = await fetch(maishaApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secretKey}`,
      },
      body: JSON.stringify(maishaPayload),
    });

    const rawText = await maishaResponse.text();
    let maishaData: any = null;
    try {
      maishaData = JSON.parse(rawText);
    } catch {
      maishaData = { raw: rawText };
    }

    console.log(`[${requestId}] MAISHAPAY RESPONSE:`, {
      status: maishaResponse.status,
      ok: maishaResponse.ok,
      hasCheckoutUrl: !!(maishaData?.checkoutUrl || maishaData?.paymentUrl || maishaData?.url),
    });

    if (!maishaResponse.ok) {
      const errorMessage = maishaData?.message || maishaData?.error || rawText || "MaishaPay request failed";
      
      console.error(`[${requestId}] MAISHAPAY ERROR:`, {
        sentCurrency: paymentCurrency,
        sentAmount: paymentAmount,
        errorMessage,
      });
      
      return new Response(
        JSON.stringify({
          success: false,
          error: errorMessage,
          code: "MAISHAPAY_ERROR",
          requestId,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const checkoutUrl =
      maishaData.checkoutUrl ||
      maishaData.paymentUrl ||
      maishaData.url ||
      null;

    if (!checkoutUrl) {
      console.error(`[${requestId}] MISSING CHECKOUT URL in response`);
      return new Response(
        JSON.stringify({ success: false, error: "Missing checkout URL from MaishaPay", requestId }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Store payment record (keep both USD & CDF for reporting)
    const amountUsdToStore =
      paymentCurrency === "USD"
        ? paymentAmount
        : Number(order.total_usd || paymentAmount / exchangeRate);
    const amountCdfToStore =
      paymentCurrency === "CDF"
        ? paymentAmount
        : Number(order.total_cdf || paymentAmount * exchangeRate);

    const { error: paymentError } = await supabase
      .from("maisha_payments")
      .insert({
        order_id: orderId,
        maisha_reference: reference,
        status: "pending",
        amount_usd: amountUsdToStore,
        amount_cdf: amountCdfToStore,
        currency: paymentCurrency,
        raw_request: maishaPayload,
        raw_response: maishaData,
      });

    if (paymentError) {
      console.error(`[${requestId}] DB WRITE maisha_payments FAILED:`, paymentError.message);
    } else {
      console.log(`[${requestId}] DB WRITE maisha_payments OK`);
    }

    // Update order with Maisha reference
    const { error: orderUpdateError } = await supabase
      .from("orders")
      .update({
        maisha_transaction_id: reference,
        maisha_payment_status: "pending",
      })
      .eq("id", orderId);

    if (orderUpdateError) {
      console.error(`[${requestId}] DB WRITE orders FAILED:`, orderUpdateError.message);
    } else {
      console.log(`[${requestId}] DB WRITE orders OK`);
    }

    console.log(`[${requestId}] SUCCESS: checkoutUrl obtained, returning to mobile`);

    // Return data to mobile app - FLAT RESPONSE FORMAT
    return new Response(
      JSON.stringify({
        success: true,
        checkoutUrl,
        orderId,
        confirmationId: reference,
        provider: 'maishapay',
        payment_flow: 'REDIRECT',
        message: `Payment initiated in ${paymentCurrency}`,
        amount: paymentAmount,
        currency: paymentCurrency,
        requestId,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error(`[${requestId}] UNHANDLED ERROR:`, error.message);
    return new Response(JSON.stringify({ success: false, error: error.message, requestId }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
