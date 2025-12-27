import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateLinkRequest {
  order_id: string;
}

const generateToken = (): string => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
};

serve(async (req: Request): Promise<Response> => {
  console.log("[create-bank-transfer-view-link] Request received");

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

    const { order_id }: CreateLinkRequest = await req.json();

    if (!order_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing order_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[create-bank-transfer-view-link] Processing order:", order_id);

    // Verify order exists
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, status, total_usd, total_cdf")
      .eq("id", order_id)
      .single();

    if (orderError || !order) {
      console.error("[create-bank-transfer-view-link] Order not found:", orderError);
      return new Response(
        JSON.stringify({ ok: false, error: "Order not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check for existing valid token
    const { data: existingToken } = await supabase
      .from("bank_transfer_view_tokens")
      .select("*")
      .eq("order_id", order_id)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingToken) {
      console.log("[create-bank-transfer-view-link] Returning existing token");
      return new Response(
        JSON.stringify({
          ok: true,
          token: existingToken.token,
          url: `${frontendBaseUrl}/bank-transfer?t=${existingToken.token}`,
          expires_at: existingToken.expires_at,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Generate new token (expires in 24 hours)
    const token = generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error: insertError } = await supabase
      .from("bank_transfer_view_tokens")
      .insert({
        token,
        order_id,
        expires_at: expiresAt,
      });

    if (insertError) {
      console.error("[create-bank-transfer-view-link] Insert error:", insertError);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to create token" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const url = `${frontendBaseUrl}/bank-transfer?t=${token}`;
    console.log("[create-bank-transfer-view-link] Created new token, URL:", url);

    return new Response(
      JSON.stringify({
        ok: true,
        token,
        url,
        expires_at: expiresAt,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[create-bank-transfer-view-link] Error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
