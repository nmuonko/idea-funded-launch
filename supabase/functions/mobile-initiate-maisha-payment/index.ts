import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      {
        global: {
          headers: { Authorization: req.headers.get("Authorization")! },
        },
      }
    );

    // 1️⃣ Auth
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2️⃣ Extract orderId from URL path
    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter((p) => p);
    const orderId = pathParts[pathParts.length - 1];

    if (!orderId) {
      return new Response(JSON.stringify({ error: "Order ID required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[Initiate Payment] Order ID:", orderId, "User:", user.id);

    // 3️⃣ Load order
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .eq("user_id", user.id)
      .single();

    if (orderError || !order) {
      console.error("[Initiate Payment] Order error:", orderError);
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (order.status !== "PENDING_PAYMENT") {
      return new Response(JSON.stringify({ error: "Order cannot be paid" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4️⃣ Load profile for phone
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    // 5️⃣ MaishaPay config
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
        JSON.stringify({ error: "MaishaPay not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 6️⃣ Determine currency & amount from the ORDER (single source of truth)
    const rawCurrency = (order.currency || "").toString().toUpperCase().trim();
    let paymentCurrency = rawCurrency === "CDF" ? "CDF" : "USD";

    const exchangeRate =
      Number(order.exchange_rate_used) ||
      Number(order.exchange_rate) ||
      2500;

    let paymentAmount = 0;

    if (paymentCurrency === "CDF") {
      // Order is in CDF – use total_cdf if possible
      paymentAmount = Number(order.total_cdf || 0);

      // Fallback: derive from USD if CDF is missing
      if ((!paymentAmount || paymentAmount <= 0) && order.total_usd) {
        paymentAmount = Number(order.total_usd) * exchangeRate;
      }
    } else {
      // Default to USD (matches working normal orders)
      paymentAmount = Number(order.total_usd || 0);

      // Fallback: derive from CDF if USD is missing
      if ((!paymentAmount || paymentAmount <= 0) && order.total_cdf) {
        paymentAmount = Number(order.total_cdf) / exchangeRate;
      }
    }

    // Round to 2 decimals
    paymentAmount = Math.round(paymentAmount * 100) / 100;

    if (!paymentAmount || paymentAmount <= 0) {
      console.error("[Initiate Payment] Invalid amount for order:", {
        orderId,
        paymentCurrency,
        total_usd: order.total_usd,
        total_cdf: order.total_cdf,
        exchangeRate,
      });
      return new Response(JSON.stringify({ error: "Invalid order amount" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 7️⃣ Create unique reference
    const reference = `AFRISHOP-${orderId}-${Date.now()}`;

    console.log("[Initiate Payment] MaishaPay payload base:", {
      orderId,
      reference,
      amount: paymentAmount,
      currency: paymentCurrency,
      gatewayMode,
      isLiveMode,
    });

    // 8️⃣ Prepare MaishaPay payload
    const maishaPayload = {
      publicKey,
      amount: paymentAmount,
      currency: paymentCurrency, // EXACT order currency
      reference,
      customerEmail: user.email || "",
      customerPhone: profile?.phone || "",
      description: `AfriShop order ${orderId}`,
      callbackUrl,
    };

    const maishaApiUrl = isLiveMode
      ? "https://marchand.maishapay.online/api/v1/transaction/create"
      : "https://sandbox.maishapay.online/api/v1/transaction/create";

    console.log("[Initiate Payment] Calling MaishaPay:", {
      url: maishaApiUrl,
      payload: maishaPayload,
    });

    // 9️⃣ Call MaishaPay
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

    console.log("[Initiate Payment] MaishaPay Response:", maishaData);

    if (!maishaResponse.ok) {
      throw new Error(
        maishaData?.message ||
          maishaData?.error ||
          rawText ||
          "MaishaPay request failed"
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
        JSON.stringify({ error: "Missing checkout URL from MaishaPay" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 🔟 Store payment record (keep both USD & CDF for reporting)
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

    // 1️⃣1️⃣ Update order with Maisha reference
    await supabase
      .from("orders")
      .update({
        maisha_transaction_id: reference,
        maisha_payment_status: "pending",
      })
      .eq("id", orderId);

    // 1️⃣2️⃣ Return data to mobile app
    return new Response(
      JSON.stringify({
        orderId,
        payment: {
          checkoutUrl,
          maishaReference: reference,
          amount: paymentAmount,
          currency: paymentCurrency,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("[Initiate Payment] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
