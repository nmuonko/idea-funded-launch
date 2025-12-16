import { serve } from "https://deno.land/std/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

/**
 * SECURITY FIX: This function now generates a complete HTML form server-side
 * instead of returning API keys to the client. The HTML is rendered in a WebView
 * which auto-submits to MaishaPay, keeping secrets server-side only.
 */
serve(async (req) => {
  console.log("[MAISHAPAY LIVE] Request received:", req.method);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, code: "METHOD_NOT_ALLOWED", message: "Method not allowed" }),
      { status: 405, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await req.json();
    console.log("[MAISHAPAY LIVE] Processing payment request for:", body.confirmationId);

    // Validate required fields
    const { amount, confirmationId, email, name } = body;
    if (!amount || !confirmationId || !email) {
      console.error("[MAISHAPAY LIVE] Missing required fields");
      return new Response(
        JSON.stringify({ ok: false, code: "MISSING_FIELDS", message: "Missing required fields" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Read LIVE config from environment
    const mode = Deno.env.get("MAISHAPAY_MODE");
    const livePublic = Deno.env.get("MAISHAPAY_LIVE_PUBLIC_KEY");
    const liveSecret = Deno.env.get("MAISHAPAY_LIVE_SECRET_KEY");
    const callbackUrl = Deno.env.get("MAISHAPAY_CALLBACK_URL");

    console.log("[MAISHAPAY LIVE] Config status:", {
      mode: mode || "NOT SET",
      hasPublicKey: !!livePublic,
      hasSecretKey: !!liveSecret,
      hasCallbackUrl: !!callbackUrl,
    });

    // Check if configuration is complete
    if (!mode || mode !== "1" || !livePublic || !liveSecret || !callbackUrl) {
      console.error("[MAISHAPAY LIVE] Configuration incomplete");
      return new Response(
        JSON.stringify({
          ok: false,
          code: "CONFIG_INCOMPLETE",
          message: "Payment gateway configuration incomplete"
        }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // The checkout URL
    const checkoutUrl = "https://marchand.maishapay.online/payment/vers1.0/merchant/checkout";

    // SECURITY FIX: Generate HTML form server-side instead of returning secrets
    // The HTML includes auto-submit JavaScript and will be rendered in mobile WebView
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Redirection vers MaishaPay</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #1a365d 0%, #2d3748 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    .spinner {
      width: 50px;
      height: 50px;
      border: 4px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 1rem;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    p {
      font-size: 1.1rem;
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="spinner"></div>
    <p>Redirection vers MaishaPay...</p>
    <p style="font-size: 0.9rem; opacity: 0.7;">Si rien ne se passe après quelques secondes, veuillez réessayer.</p>
  </div>
  <form id="paymentForm" method="POST" action="${checkoutUrl}" style="display: none;">
    <input type="hidden" name="publicApiKey" value="${escapeHtml(livePublic)}" />
    <input type="hidden" name="secretApiKey" value="${escapeHtml(liveSecret)}" />
    <input type="hidden" name="gatewayMode" value="1" />
    <input type="hidden" name="montant" value="${escapeHtml(String(amount))}" />
    <input type="hidden" name="devise" value="USD" />
    <input type="hidden" name="callbackUrl" value="${escapeHtml(callbackUrl)}" />
    <input type="hidden" name="reference" value="${escapeHtml(confirmationId)}" />
    <input type="hidden" name="email_client" value="${escapeHtml(email)}" />
    <input type="hidden" name="nom_client" value="${escapeHtml(name || '')}" />
  </form>
  <script>
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(function() {
        document.getElementById('paymentForm').submit();
      }, 500);
    });
  </script>
</body>
</html>`;

    console.log("[MAISHAPAY LIVE] Generated payment form HTML for reference:", confirmationId);

    // Return HTML for WebView rendering - NO SECRETS IN JSON RESPONSE
    return new Response(
      JSON.stringify({
        ok: true,
        html: html,
        // Only return non-sensitive data for mobile app display
        reference: confirmationId,
        amount: amount,
        currency: "USD"
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    // SECURITY FIX: Don't expose error details to client
    console.error("[MAISHAPAY LIVE] ERROR:", error);
    return new Response(
      JSON.stringify({ ok: false, code: "INTERNAL_ERROR", message: "An error occurred processing your request" }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});

// Helper to escape HTML entities to prevent XSS
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
