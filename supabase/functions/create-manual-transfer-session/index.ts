import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateSessionRequest {
  order_id: string;
}

const generateToken = (): string => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
};

const generateReference = (orderId: string): string => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const shortId = orderId.slice(0, 8).toUpperCase();
  return `VIR-${shortId}-${timestamp}`;
};

serve(async (req: Request): Promise<Response> => {
  console.log("[create-manual-transfer-session] Request received");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const frontendBaseUrl = Deno.env.get("FRONTEND_BASE_URL") || "https://afrishop-usa.com";

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { order_id }: CreateSessionRequest = await req.json();

    if (!order_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing order_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[create-manual-transfer-session] Processing order:", order_id);

    // Verify order exists and get customer info
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(`
        id, 
        status,
        total_usd,
        total_cdf,
        user_id,
        profiles!orders_user_id_fkey (
          full_name,
          email,
          phone
        )
      `)
      .eq("id", order_id)
      .single();

    if (orderError || !order) {
      console.error("[create-manual-transfer-session] Order not found:", orderError);
      return new Response(
        JSON.stringify({ ok: false, error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for existing active session
    const { data: existingSession } = await supabase
      .from("manual_transfer_sessions")
      .select("*")
      .eq("order_id", order_id)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (existingSession) {
      console.log("[create-manual-transfer-session] Returning existing session");
      return new Response(
        JSON.stringify({
          ok: true,
          session_id: existingSession.id,
          upload_token: existingSession.upload_token,
          reference: existingSession.reference,
          url: `${frontendBaseUrl}/manual-transfer/${existingSession.upload_token}`,
          expires_at: existingSession.expires_at,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create new session
    const uploadToken = generateToken();
    const reference = generateReference(order_id);

    const { data: newSession, error: insertError } = await supabase
      .from("manual_transfer_sessions")
      .insert({
        order_id,
        reference,
        upload_token: uploadToken,
        status: "active",
      })
      .select()
      .single();

    if (insertError) {
      console.error("[create-manual-transfer-session] Insert error:", insertError);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to create session" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[create-manual-transfer-session] Created new session:", newSession.id);

    // Trigger notification for large transfers ($1000+)
    const amountUsd = Number(order.total_usd) || 0;
    if (amountUsd >= 1000) {
      try {
        const profile = order.profiles as { full_name?: string; email?: string; phone?: string } | null;
        await supabase.functions.invoke("notify-large-bank-transfer", {
          body: {
            order_id,
            reference: newSession.reference,
            amount_usd: amountUsd,
            amount_cdf: Number(order.total_cdf) || undefined,
            customer_name: profile?.full_name,
            customer_email: profile?.email,
            customer_phone: profile?.phone,
          },
        });
        console.log("[create-manual-transfer-session] Large transfer notification sent");
      } catch (notifyErr) {
        console.error("[create-manual-transfer-session] Notification error (non-blocking):", notifyErr);
      }
    }

    // Generate secure bank transfer view link
    let bankTransferUrl: string | undefined;
    try {
      const { data: linkResult } = await supabase.functions.invoke("create-bank-transfer-view-link", {
        body: { order_id },
      });
      if (linkResult?.ok && linkResult?.url) {
        bankTransferUrl = linkResult.url;
        console.log("[create-manual-transfer-session] Bank transfer view URL:", bankTransferUrl);
      }
    } catch (linkErr) {
      console.error("[create-manual-transfer-session] Failed to create bank view link (non-blocking):", linkErr);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        session_id: newSession.id,
        upload_token: newSession.upload_token,
        reference: newSession.reference,
        url: `${frontendBaseUrl}/manual-transfer/${newSession.upload_token}`,
        bank_transfer_url: bankTransferUrl,
        expires_at: newSession.expires_at,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[create-manual-transfer-session] Error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
