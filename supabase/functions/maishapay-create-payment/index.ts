import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  console.log("[MaishaPay Create] Request received:", req.method);

  // CORS preflight
  if (req.method === "OPTIONS") {
    console.log("[MaishaPay Create] Handling OPTIONS preflight");
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  // ONLY allow POST from frontend
  if (req.method !== "POST") {
    console.error("[MaishaPay Create] Invalid method:", req.method);
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

    console.log("[MaishaPay Create] Processing payment request:", {
      submissionId,
      amount,
      confirmationId,
      email,
    });

    if (!amount || !confirmationId || !email || !submissionId) {
      console.error("[MaishaPay Create] Missing required fields");
      return new Response(
        JSON.stringify({ 
          error: "Missing required fields: submissionId, amount, confirmationId, or email" 
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Read secrets from Deno.env - BACKEND ONLY
    const mode = (Deno.env.get("MAISHAPAY_MODE") ?? "sandbox").toLowerCase();
    const isLive = mode === "live";

    // Use old secret names that exist in the project
    const sandboxPublic = Deno.env.get("MAISHAPAY_PUBLIC_KEY_TEST");
    const sandboxSecret = Deno.env.get("MAISHAPAY_SECRET_KEY_TEST");
    
    // For live mode - these may not exist yet
    const livePublic = Deno.env.get("MAISHAPAY_LIVE_PUBLIC_KEY");
    const liveSecret = Deno.env.get("MAISHAPAY_LIVE_SECRET_KEY");
    
    const callbackUrl = Deno.env.get("MAISHAPAY_CALLBACK_URL");

    const publicApiKey = isLive ? livePublic : sandboxPublic;
    const secretApiKey = isLive ? liveSecret : sandboxSecret;

    console.log("[MaishaPay Create] Configuration check:", {
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
      console.error("[MaishaPay Create] Configuration incomplete");
      return new Response(
        JSON.stringify({ 
          error: "MaishaPay configuration incomplete. Please contact support." 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const gatewayMode = isLive ? "1" : "0";

    // Build full callback URL with submission ID
    const fullCallbackUrl = `${callbackUrl}?submission_id=${submissionId}`;

    // MaishaPay checkout URL
    const checkoutUrl = "https://marchand.maishapay.online/payment/vers1.0/merchant/checkout";

    // Build form data for POST (MaishaPay requires POST, not GET)
    const formHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Redirecting to Payment...</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .loader {
      text-align: center;
    }
    .spinner {
      border: 4px solid rgba(255,255,255,0.3);
      border-top: 4px solid white;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 20px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="loader">
    <div class="spinner"></div>
    <h2>Redirecting to MaishaPay...</h2>
    <p>Please wait while we redirect you to the secure payment page.</p>
  </div>
  <form id="maishapay-form" method="POST" action="${checkoutUrl}">
    <input type="hidden" name="publicApiKey" value="${publicApiKey}" />
    <input type="hidden" name="secretApiKey" value="${secretApiKey}" />
    <input type="hidden" name="gatewayMode" value="${gatewayMode}" />
    <input type="hidden" name="montant" value="${amount}" />
    <input type="hidden" name="devise" value="USD" />
    <input type="hidden" name="callbackUrl" value="${fullCallbackUrl}" />
    <input type="hidden" name="reference" value="${confirmationId}" />
    <input type="hidden" name="email_client" value="${email}" />
  </form>
  <script>
    // Auto-submit the form immediately
    document.getElementById('maishapay-form').submit();
  </script>
</body>
</html>
    `.trim();

    console.log("[MaishaPay Create] Generated auto-submit form", {
      mode,
      gatewayMode,
      amount,
      reference: confirmationId,
      callbackUrl: fullCallbackUrl,
    });

    // Return HTML that auto-submits to MaishaPay via POST
    return new Response(formHtml, {
      status: 200,
      headers: { 
        ...corsHeaders, 
        "Content-Type": "text/html; charset=utf-8" 
      },
    });
  } catch (err: any) {
    console.error("[MaishaPay Create] Exception:", err.message, err.stack);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: err.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
