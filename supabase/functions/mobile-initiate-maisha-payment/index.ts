import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { 
  detectVehicleOrder, 
  getPaymentCurrencyAndAmount,
  VEHICLE_CURRENCY_ERROR 
} from "../_shared/vehiclePaymentGuard.ts";

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

    // 6️⃣ 🚗 VEHICLE CURRENCY GUARD - Detect vehicle orders
    const vehicleDetection = await detectVehicleOrder(supabase, orderId);
    const containsVehicle = vehicleDetection.isVehicle;

    console.log("[Initiate Payment] VEHICLE DETECTION:", {
      orderId,
      containsVehicle,
      vehicleItemCount: vehicleDetection.vehicleItems.length,
      reasons: vehicleDetection.reasons,
    });

    // 7️⃣ Determine currency & amount using shared helper
    const exchangeRate =
      Number(order.exchange_rate_used) ||
      Number(order.exchange_rate) ||
      2500;
    
    const totalUsd = Number(order.total_usd) || 0;
    const totalCdf = Number(order.total_cdf) || (totalUsd * exchangeRate);

    // 💰 Use CDF for high-value/vehicle orders to avoid MaishaPay USD limits
    const paymentInfo = getPaymentCurrencyAndAmount(totalUsd, totalCdf, containsVehicle, exchangeRate);
    const { currency: paymentCurrency, amount: paymentAmount, amountFormatted, displayAmount, usedCdf, reason: currencyReason } = paymentInfo;

    console.log("[Initiate Payment] CURRENCY SELECTION:", {
      orderId,
      containsVehicle,
      totalUsd,
      totalCdf,
      exchangeRate,
      paymentCurrency,
      paymentAmount,
      amountFormatted,
      displayAmount,
      usedCdf,
      currencyReason,
    });

    // Update order with currency audit fields
    if (containsVehicle || usedCdf) {
      const adminSupabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      
      await adminSupabase.from("orders").update({
        contains_vehicle: containsVehicle,
        normalized_currency: paymentCurrency,
        normalized_amount: paymentAmount,
      }).eq("id", orderId);
    }

    // 8️⃣ Validate amount
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      console.error("[Initiate Payment] INVALID AMOUNT:", {
        orderId,
        containsVehicle,
        paymentCurrency,
        paymentAmount,
        total_usd: order.total_usd,
        total_cdf: order.total_cdf,
        exchangeRate,
      });
      return new Response(
        JSON.stringify({ 
          error: "Invalid order amount",
          code: "INVALID_AMOUNT",
        }), 
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 9️⃣ Create unique reference
    const reference = `AFRISHOP-${orderId}-${Date.now()}`;

    // 🔟 Log VEHICLE CURRENCY GUARD diagnostics
    console.log("[Initiate Payment] VEHICLE CURRENCY GUARD RESULT:", {
      order_id: orderId,
      is_vehicle_order: containsVehicle,
      original_currency_from_order: order.currency || "undefined",
      original_amount_usd: order.total_usd,
      original_amount_cdf: order.total_cdf,
      final_currency: paymentCurrency,
      final_amount: paymentAmount,
      payment_method: "card",
      exchange_rate: exchangeRate,
    });

    // 1️⃣1️⃣ Prepare MaishaPay payload
    const maishaPayload = {
      publicKey,
      amount: paymentAmount,
      currency: paymentCurrency,
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
      currency: paymentCurrency,
      amount: paymentAmount,
      containsVehicle,
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
      
      // Check for currency error specifically
      if (errorMessage.toLowerCase().includes("devise") || errorMessage.toLowerCase().includes("currency")) {
        console.error("[Initiate Payment] CURRENCY ERROR from MaishaPay:", {
          orderId,
          containsVehicle,
          sentCurrency: paymentCurrency,
          sentAmount: paymentAmount,
          errorMessage,
        });
        
        return new Response(
          JSON.stringify({
            error: errorMessage,
            ...VEHICLE_CURRENCY_ERROR,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      
      throw new Error(errorMessage);
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

    // 1️⃣5️⃣ Return data to mobile app
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
