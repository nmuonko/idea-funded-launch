import { serve } from "https://deno.land/std/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

serve(async (req) => {
  console.log("[MAISHAPAY LIVE] Request received:", req.method);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method Not Allowed" }),
      { status: 405, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await req.json();
    console.log("[MAISHAPAY LIVE] REQUEST BODY:", JSON.stringify(body, null, 2));

    // Validate required fields
    const { amount, confirmationId, email, name } = body;
    if (!amount || !confirmationId || !email) {
      console.error("[MAISHAPAY LIVE] Missing required fields:", { amount, confirmationId, email });
      return new Response(
        JSON.stringify({ error: "Missing required fields: amount, confirmationId, email" }),
        { status: 400, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Read LIVE config from environment
    const mode = Deno.env.get("MAISHAPAY_MODE");
    const livePublic = Deno.env.get("MAISHAPAY_LIVE_PUBLIC_KEY");
    const liveSecret = Deno.env.get("MAISHAPAY_LIVE_SECRET_KEY");
    const callbackUrl = Deno.env.get("MAISHAPAY_CALLBACK_URL");

    console.log("[MAISHAPAY LIVE] CONFIG:", {
      mode: mode || "NOT SET",
      livePublic: livePublic ? `${livePublic.substring(0, 15)}...` : "NOT SET",
      liveSecret: liveSecret ? `${liveSecret.substring(0, 15)}...` : "NOT SET",
      callbackUrl: callbackUrl || "NOT SET",
    });

    // Check if configuration is complete
    if (!mode || mode !== "1" || !livePublic || !liveSecret || !callbackUrl) {
      console.error("[MAISHAPAY LIVE] Configuration incomplete:", {
        mode,
        hasPublicKey: !!livePublic,
        hasSecretKey: !!liveSecret,
        hasCallbackUrl: !!callbackUrl,
      });
      return new Response(
        JSON.stringify({
          error: "MaishaPay LIVE configuration incomplete",
          config: { mode, hasPublicKey: !!livePublic, hasSecretKey: !!liveSecret, hasCallbackUrl: !!callbackUrl }
        }),
        { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    // Build form data for MaishaPay checkout
    const form = new URLSearchParams();
    form.set("publicApiKey", livePublic);
    form.set("secretApiKey", liveSecret);
    form.set("gatewayMode", "1"); // LIVE mode
    form.set("montant", amount.toString());
    form.set("devise", "USD");
    form.set("callbackUrl", callbackUrl);
    form.set("reference", confirmationId);
    form.set("email_client", email);
    if (name) form.set("nom_client", name);

    console.log("[MAISHAPAY LIVE] Form data prepared:", {
      gatewayMode: "1",
      montant: amount,
      devise: "USD",
      reference: confirmationId,
      email_client: email,
      nom_client: name || "N/A",
    });

    // The checkout URL
    const checkoutUrl = "https://marchand.maishapay.online/payment/vers1.0/merchant/checkout";

    // Return the checkout URL and fields to the frontend
    // Frontend will create a hidden form and auto-submit it
    return new Response(
      JSON.stringify({
        ok: true,
        checkoutUrl,
        fields: {
          publicApiKey: livePublic,
          secretApiKey: liveSecret,
          gatewayMode: "1",
          montant: amount.toString(),
          devise: "USD",
          callbackUrl,
          reference: confirmationId,
          email_client: email,
          nom_client: name || "",
        },
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[MAISHAPAY LIVE] ERROR:", error);
    return new Response(
      JSON.stringify({ error: "Internal error", details: error.message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
