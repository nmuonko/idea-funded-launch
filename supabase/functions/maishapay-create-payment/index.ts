import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    console.log("[MaishaPay] Handling OPTIONS preflight");
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  // ONLY allow POST from frontend
  if (req.method !== "POST") {
    console.error("[MaishaPay] Invalid method:", req.method);
    return new Response(
      JSON.stringify({ error: "Method Not Allowed", method: req.method }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const submissionId = String(body.submissionId ?? "");
    const amount = Number(body.amount ?? 0);
    const confirmationId = String(body.confirmationId ?? "");
    const email = String(body.email ?? "");
    const name = String(body.name ?? "");

    console.log("[MaishaPay] Processing payment request:", {
      submissionId,
      amount,
      confirmationId,
      email,
      name,
    });

    if (!amount || !confirmationId || !email || !submissionId) {
      console.error("[MaishaPay] Missing required fields");
      return new Response(
        JSON.stringify({ error: "Missing required fields: submissionId, amount, confirmationId, or email" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Read secrets from Deno.env
    const mode = (Deno.env.get("MAISHAPAY_MODE") ?? "sandbox").toLowerCase();
    const isLive = mode === "live";

    const sandboxPublic = Deno.env.get("VITE_MAISHAPAY_SANDBOX_PUBLIC_KEY");
    const sandboxSecret = Deno.env.get("VITE_MAISHAPAY_SANDBOX_SECRET_KEY");
    const livePublic = Deno.env.get("VITE_MAISHAPAY_LIVE_PUBLIC_KEY");
    const liveSecret = Deno.env.get("VITE_MAISHAPAY_LIVE_SECRET_KEY");
    const callbackUrl = Deno.env.get("MAISHAPAY_CALLBACK_URL");

    const publicApiKey = isLive ? livePublic : sandboxPublic;
    const secretApiKey = isLive ? liveSecret : sandboxSecret;

    console.log("[MaishaPay] Configuration check:", {
      mode,
      isLive,
      hasSandboxPublic: !!sandboxPublic,
      hasSandboxSecret: !!sandboxSecret,
      hasLivePublic: !!livePublic,
      hasLiveSecret: !!liveSecret,
      hasCallback: !!callbackUrl,
      usingPublicKey: !!publicApiKey,
      usingSecretKey: !!secretApiKey,
    });

    if (!publicApiKey || !secretApiKey || !callbackUrl) {
      console.error("[MaishaPay] Configuration incomplete");
      return new Response(
        JSON.stringify({ error: "MaishaPay configuration incomplete. Please contact support." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const gatewayMode = isLive ? "1" : "0";

    // Build full callback URL with submission ID
    const fullCallbackUrl = `${callbackUrl}?submission_id=${submissionId}`;

    // Build URL with query parameters (MaishaPay expects GET-style redirect URL)
    const checkoutUrl = new URL("https://marchand.maishapay.online/payment/vers1.0/merchant/checkout");
    checkoutUrl.searchParams.set("publicApiKey", publicApiKey);
    checkoutUrl.searchParams.set("secretApiKey", secretApiKey);
    checkoutUrl.searchParams.set("gatewayMode", gatewayMode);
    checkoutUrl.searchParams.set("montant", amount.toString());
    checkoutUrl.searchParams.set("devise", "USD");
    checkoutUrl.searchParams.set("callbackUrl", fullCallbackUrl);
    checkoutUrl.searchParams.set("reference", confirmationId);
    checkoutUrl.searchParams.set("email_client", email);

    const redirectUrl = checkoutUrl.toString();

    console.log("[MaishaPay] Payment URL generated successfully", {
      mode,
      gatewayMode,
      amount,
      reference: confirmationId,
      callbackUrl: fullCallbackUrl,
    });

    return new Response(
      JSON.stringify({ 
        redirectUrl,
        mode,
        confirmationId,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("[MaishaPay] Exception:", err.message, err.stack);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
