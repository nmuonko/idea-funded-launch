import { serve } from "https://deno.land/std/http/server.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

serve(async (req) => {
  console.log("[MAISHAPAY RESET] Request received:", req.method);

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
    console.log("[MAISHAPAY RESET] REQUEST BODY:", JSON.stringify(body, null, 2));

    const livePublic = Deno.env.get("MAISHAPAY_LIVE_PUBLIC_KEY");
    const liveSecret = Deno.env.get("MAISHAPAY_LIVE_SECRET_KEY");
    const mode = Deno.env.get("MAISHAPAY_MODE");
    const callbackUrl = Deno.env.get("MAISHAPAY_CALLBACK_URL");

    console.log("[MAISHAPAY RESET] LIVE CONFIG:", {
      livePublic: livePublic || "NOT SET",
      liveSecret: liveSecret || "NOT SET",
      mode: mode || "NOT SET",
      callbackUrl: callbackUrl || "NOT SET",
    });

    // Return directly for now — we will fill logic after keys are added
    return new Response(
      JSON.stringify({
        ok: true,
        message: "Ready to accept LIVE keys",
        received: body,
        config: {
          livePublic: livePublic || null,
          liveSecret: liveSecret || null,
          mode: mode || null,
          callbackUrl: callbackUrl || null
        }
      }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[MAISHAPAY RESET] ERROR:", error);
    return new Response(
      JSON.stringify({ error: "Internal error", details: error.message }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } }
    );
  }
});
