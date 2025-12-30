import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Payment limits
const USD_LIMIT = 5000;
const CDF_LIMIT = 30000000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1️⃣ Parse request JSON body for forceCurrency and shippingCity
    const body = await req.json().catch(() => ({}));
    const forceCurrency: 'USD' | 'CDF' | null = body.forceCurrency || null;
    const shippingCity: string | null = body.shippingCity || null;

    console.log("[Initiate Payment] Request body:", { forceCurrency, shippingCity });

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
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3️⃣ Extract orderId from URL path
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter((p) => p);
    const orderId = pathParts[pathParts.length - 1];

    if (!orderId) {
      return new Response(JSON.stringify({ success: false, error: "Order ID required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[Initiate Payment] Order ID:", orderId, "User:", user.id);

    // 4️⃣ Load order
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .eq("user_id", user.id)
      .single();

    if (orderError || !order) {
      console.error("[Initiate Payment] Order error:", orderError);
      return new Response(JSON.stringify({ success: false, error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (order.status !== "PENDING_PAYMENT") {
      return new Response(JSON.stringify({ success: false, error: "Order cannot be paid" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5️⃣ Load profile for phone
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    // 6️⃣ MaishaPay config
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
      console.error("[Initiate Payment] Missing MaishaPay config:", {
        hasPublicKey: !!publicKey,
        hasSecretKey: !!secretKey,
        hasCallbackUrl: !!callbackUrl,
        gatewayMode,
        isLiveMode,
      });
      return new Response(
        JSON.stringify({ success: false, error: "MaishaPay not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 7️⃣ PAYMENT ROUTING RULES - Calculate totals
    const totalUsd = Number(order.total_usd) || 0;
    const exchangeRate = Number(order.exchange_rate_used) || Number(order.exchange_rate) || 2500;
    const computedCdf = Math.round(totalUsd * exchangeRate);
    const orderCdf = Number(order.total_cdf);
    const resolvedOrderCdf = Number.isFinite(orderCdf) && orderCdf > 0 ? orderCdf : computedCdf;

    console.log("[Initiate Payment] CDF AMOUNT RESOLUTION:", { totalUsd, exchangeRate, computedCdf, orderCdf, resolvedOrderCdf });

    console.log("[Initiate Payment] ROUTING DECISION:", {
      orderId,
      totalUsd,
      exchangeRate,
      computedCdf,
      resolvedOrderCdf,
      forceCurrency,
      USD_LIMIT,
      CDF_LIMIT,
    });

    // RULE 2c: Block if exceeds all limits - BANK TRANSFER REQUIRED
    if (totalUsd > USD_LIMIT && computedCdf > CDF_LIMIT) {
      console.log("[Initiate Payment] BLOCKED - BANK_TRANSFER_REQUIRED");
      return new Response(
        JSON.stringify({
          success: false,
          code: 'BANK_TRANSFER_REQUIRED',
          totalUsd,
          cdfConverted: computedCdf,
          cap: CDF_LIMIT,
          message_fr: `Montant trop élevé (${computedCdf.toLocaleString()} CDF). Virement bancaire requis.`,
          message_en: `Amount too high (${computedCdf.toLocaleString()} CDF). Bank transfer required.`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 8️⃣ Determine currency & amount based on routing rules
    let paymentCurrency: 'USD' | 'CDF';
    let paymentAmount: number;
    let currencyReason: string;

    // RULE 2b: If USD > 5000 but CDF <= 30M, FORCE CDF (overrides forceCurrency)
    if (totalUsd > USD_LIMIT && computedCdf <= CDF_LIMIT) {
      paymentCurrency = 'CDF';
      paymentAmount = resolvedOrderCdf;
      currencyReason = 'FORCE_CDF_HIGH_USD';
      console.log("[Initiate Payment] FORCED CDF due to high USD value:", { totalUsd, computedCdf, resolvedOrderCdf });
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
        // Default: use USD for amounts within limit
        paymentCurrency = 'USD';
        paymentAmount = totalUsd;
        currencyReason = 'DEFAULT_USD';
      }
    } else {
      // Fallback (should not reach here given rule checks above)
      paymentCurrency = 'USD';
      paymentAmount = totalUsd;
      currencyReason = 'FALLBACK';
    }

    console.log("[Initiate Payment] FINAL CURRENCY:", {
      paymentCurrency,
      paymentAmount,
      forceCurrency,
      currencyReason,
    });

    // Update order with currency audit fields (safe guard for missing service key)
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (serviceKey) {
      const adminSupabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        serviceKey
      );
      const { error: auditErr } = await adminSupabase.from("orders").update({
        normalized_currency: paymentCurrency,
        normalized_amount: paymentAmount,
        exchange_rate_used: exchangeRate,
      }).eq("id", orderId);
      if (auditErr) console.warn("[Initiate Payment] Audit update failed:", auditErr);
    } else {
      console.warn("[Initiate Payment] Missing SUPABASE_SERVICE_ROLE_KEY: skipping audit update");
    }

    // 9️⃣ Validate amount
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      console.error("[Initiate Payment] INVALID AMOUNT:", {
        orderId,
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
        }), 
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 🔟 Create unique reference
    const reference = `AFRISHOP-${orderId}-${Date.now()}`;

    console.log("[Initiate Payment] PAYMENT DETAILS:", {
      order_id: orderId,
      original_amount_usd: order.total_usd,
      original_amount_cdf: order.total_cdf,
      final_currency: paymentCurrency,
      final_amount: paymentAmount,
      exchange_rate: exchangeRate,
      currency_reason: currencyReason,
      reference,
    });

    // 1️⃣1️⃣ Prepare MaishaPay payload
    const customerPhone =
      profile?.phone ||
      (profile as any)?.phone_number ||
      (profile as any)?.phoneNumber ||
      (profile as any)?.phoneNumberFormatted ||
      "";

    console.log("[Initiate Payment] CUSTOMER CONTACT:", { email: user.email, customerPhone });

    const maishaPayload = {
      publicKey,
      amount: paymentAmount,
      currency: paymentCurrency,
      reference,
      customerEmail: user.email || "",
      customerPhone,
      description: `AfriShop order ${orderId}`,
      callbackUrl,
    };

    const maishaApiUrl = isLiveMode
      ? "https://marchand.maishapay.online/api/v1/transaction/create"
      : "https://sandbox.maishapay.online/api/v1/transaction/create";

    console.log("[Initiate Payment] Calling MaishaPay:", {
      url: maishaApiUrl,
      currency: paymentCurrency,
      amount: paymentAmount,
    });

    // 1️⃣2️⃣ Call MaishaPay
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

    console.log("[Initiate Payment] MaishaPay Response:", {
      status: maishaResponse.status,
      ok: maishaResponse.ok,
      hasCheckoutUrl: !!(maishaData?.checkoutUrl || maishaData?.paymentUrl || maishaData?.url),
    });

    if (!maishaResponse.ok) {
      const errorMessage = maishaData?.message || maishaData?.error || rawText || "MaishaPay request failed";
      
      console.error("[Initiate Payment] MaishaPay ERROR:", {
        orderId,
        sentCurrency: paymentCurrency,
        sentAmount: paymentAmount,
        errorMessage,
      });
      
      return new Response(
        JSON.stringify({
          success: false,
          error: errorMessage,
          code: "MAISHAPAY_ERROR",
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
      console.error("[Initiate Payment] Missing checkout URL in response");
      return new Response(
        JSON.stringify({ success: false, error: "Missing checkout URL from MaishaPay" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 1️⃣3️⃣ Store payment record (keep both USD & CDF for reporting)
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
      console.error(
        "[Initiate Payment] Error creating maisha_payments record:",
        paymentError
      );
    }

    // 1️⃣4️⃣ Update order with Maisha reference
    await supabase
      .from("orders")
      .update({
        maisha_transaction_id: reference,
        maisha_payment_status: "pending",
      })
      .eq("id", orderId);

    // 1️⃣5️⃣ Return data to mobile app - FLAT RESPONSE FORMAT
    return new Response(
      JSON.stringify({
        success: true,
        checkoutUrl,
        orderId,
        confirmationId: reference,
        message: `Payment initiated in ${paymentCurrency}`,
        amount: paymentAmount,
        currency: paymentCurrency,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("[Initiate Payment] Error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
