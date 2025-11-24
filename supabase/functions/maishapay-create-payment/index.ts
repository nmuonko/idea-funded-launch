import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface PaymentRequest {
  submissionId: string;
  amount: number;
  confirmationId: string;
  email: string;
  name: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { submissionId, amount, confirmationId, email, name }: PaymentRequest = await req.json();

    console.log('[MaishaPay Create Payment] Processing request:', {
      submissionId,
      amount,
      confirmationId,
      email,
    });

    // Read environment variables
    const mode = (Deno.env.get("MAISHAPAY_MODE") ?? "sandbox").toLowerCase();
    const sandboxPublicKey = Deno.env.get("MAISHAPAY_SANDBOX_PUBLIC_KEY");
    const sandboxSecretKey = Deno.env.get("MAISHAPAY_SANDBOX_SECRET_KEY");
    const livePublicKey = Deno.env.get("MAISHAPAY_LIVE_PUBLIC_KEY");
    const liveSecretKey = Deno.env.get("MAISHAPAY_LIVE_SECRET_KEY");
    const callbackUrl = Deno.env.get("MAISHAPAY_CALLBACK_URL");
    const frontendBaseUrl = Deno.env.get("FRONTEND_BASE_URL") || "https://afrifund.lovable.app";

    // Determine which keys to use
    const isLive = mode === "live";
    const publicApiKey = isLive ? livePublicKey : sandboxPublicKey;
    const secretApiKey = isLive ? liveSecretKey : sandboxSecretKey;
    const gatewayMode = isLive ? "1" : "0";

    // Validate configuration
    if (!publicApiKey || !secretApiKey || !callbackUrl) {
      console.error('[MaishaPay Create Payment] Missing configuration:', {
        hasPublicKey: !!publicApiKey,
        hasSecretKey: !!secretApiKey,
        hasCallbackUrl: !!callbackUrl,
      });
      throw new Error("MaishaPay configuration incomplete");
    }

    console.log('[MaishaPay Create Payment] Using mode:', mode, 'Gateway:', gatewayMode);

    // Construct full callback URL with submission ID
    const fullCallbackUrl = `${callbackUrl}?submission_id=${submissionId}`;

    // Construct MaishaPay checkout URL with query parameters
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

    console.log('[MaishaPay Create Payment] Generated redirect URL (keys hidden)');
    console.log('[MaishaPay Create Payment] Callback URL:', fullCallbackUrl);
    console.log('[MaishaPay Create Payment] Reference:', confirmationId);

    return new Response(
      JSON.stringify({ 
        redirectUrl,
        mode,
        confirmationId,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  } catch (error: any) {
    console.error('[MaishaPay Create Payment] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to create payment" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
