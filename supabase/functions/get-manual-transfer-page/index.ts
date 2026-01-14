import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GetPageRequest {
  upload_token: string;
}

serve(async (req: Request): Promise<Response> => {
  console.log("[get-manual-transfer-page] Request received");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing Supabase configuration");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { upload_token }: GetPageRequest = await req.json();

    // Validate token format
    if (!upload_token || typeof upload_token !== "string" || upload_token.length < 32) {
      console.log("[get-manual-transfer-page] Invalid token format");
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid token", code: "INVALID_TOKEN" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[get-manual-transfer-page] Looking up token:", upload_token.slice(0, 8) + "...");

    // Find the session
    const { data: session, error: sessionError } = await supabase
      .from("manual_transfer_sessions")
      .select("*")
      .eq("upload_token", upload_token)
      .maybeSingle();

    if (sessionError) {
      console.error("[get-manual-transfer-page] Session lookup error:", sessionError);
      return new Response(
        JSON.stringify({ ok: false, error: "Session lookup failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!session) {
      console.log("[get-manual-transfer-page] Session not found");
      return new Response(
        JSON.stringify({ ok: false, error: "Session not found", code: "NOT_FOUND" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if expired
    if (new Date(session.expires_at) < new Date()) {
      console.log("[get-manual-transfer-page] Session expired");
      // Update status to expired
      await supabase
        .from("manual_transfer_sessions")
        .update({ status: "expired" })
        .eq("id", session.id);

      return new Response(
        JSON.stringify({ ok: false, error: "Session expired", code: "EXPIRED" }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get bank settings from dedicated bank_transfer_settings singleton table
    const { data: bankSettings } = await supabase
      .from("bank_transfer_settings")
      .select("*")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Check if proof already submitted
    const { data: proofs } = await supabase
      .from("manual_transfer_proofs")
      .select("id, status, created_at")
      .eq("session_id", session.id)
      .order("created_at", { ascending: false });

    const hasProofs = proofs && proofs.length > 0;
    const latestProofStatus = hasProofs ? proofs[0].status : null;

    console.log("[get-manual-transfer-page] Returning page data for session:", session.id);

    return new Response(
      JSON.stringify({
        ok: true,
        reference: session.reference,
        status: session.status,
        expires_at: session.expires_at,
        has_proof: hasProofs,
        proof_status: latestProofStatus,
        bank: {
          account_name: bankSettings?.beneficiary_name || "AfriShop USA LLC",
          bank_name: bankSettings?.bank_name || "Equity BCDC",
          account_number: bankSettings?.account_number_or_iban || "",
          swift_bic: bankSettings?.swift_bic || "",
          currency: "USD",
          instructions_fr: bankSettings?.instructions_fr || "Veuillez effectuer le virement bancaire en utilisant la référence indiquée.",
          instructions_en: bankSettings?.instructions_en || "Please make the bank transfer using the reference indicated.",
          support_whatsapp: bankSettings?.support_whatsapp || "",
          support_email: bankSettings?.support_email || "",
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[get-manual-transfer-page] Error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
