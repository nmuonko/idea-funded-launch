import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_CTA = new Set([
  "deposit_30",
  "full_100",
  "plan_explained",
  "payment_link",
  "order_now",
  "contact_agent",
  "admin_share_plan",
]);
const ALLOWED_CHANNEL = new Set(["chatbot", "admin_portal", "checkout", "email", "shop"]);
const ALLOWED_ROLE = new Set(["customer", "admin", "guest"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const ctaType = String(body.cta_type || "").trim();
    if (!ALLOWED_CTA.has(ctaType)) {
      return new Response(JSON.stringify({ error: "invalid_cta_type" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const channel = ALLOWED_CHANNEL.has(body.channel) ? body.channel : "chatbot";
    const actorRole = ALLOWED_ROLE.has(body.actor_role) ? body.actor_role : "customer";

    // Resolve user from Authorization header
    let userId: string | null = null;
    const auth = req.headers.get("authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token) {
      const { data } = await supabase.auth.getUser(token);
      userId = data?.user?.id ?? null;
    }

    const ua = req.headers.get("user-agent") || null;
    const ipRaw = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
    let ipHash: string | null = null;
    if (ipRaw) {
      const hashBuf = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(ipRaw),
      );
      ipHash = Array.from(new Uint8Array(hashBuf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }

    const { data, error } = await supabase
      .from("payment_cta_clicks")
      .insert({
        cta_type: ctaType,
        channel,
        actor_role: actorRole,
        user_id: actorRole === "admin" ? null : userId,
        admin_id: actorRole === "admin" ? userId : null,
        order_id: body.order_id || null,
        conversation_id: body.conversation_id || null,
        product_id: body.product_id ? String(body.product_id) : null,
        product_title: body.product_title ? String(body.product_title).slice(0, 500) : null,
        product_url: body.product_url ? String(body.product_url).slice(0, 1000) : null,
        amount_usd: body.amount_usd != null ? Number(body.amount_usd) : null,
        session_id: body.session_id ? String(body.session_id).slice(0, 100) : null,
        metadata: typeof body.metadata === "object" && body.metadata ? body.metadata : {},
        user_agent: ua ? ua.slice(0, 500) : null,
        ip_hash: ipHash,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[track-payment-cta] insert error", error);
      return new Response(JSON.stringify({ ok: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, id: data?.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[track-payment-cta] fatal", e);
    return new Response(JSON.stringify({ ok: false }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
