import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GetViewRequest {
  t: string;
}

// Generate a friendly reference from order ID
const generateReference = (orderId: string): string => {
  const shortId = orderId.slice(0, 8).toUpperCase();
  return `VIR-${shortId}`;
};

serve(async (req: Request): Promise<Response> => {
  console.log("[get-bank-transfer-view] Request received");

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

    // Get token from query params or body
    let token: string | null = null;
    
    const url = new URL(req.url);
    token = url.searchParams.get("t");

    if (!token && req.method === "POST") {
      const body: GetViewRequest = await req.json();
      token = body.t;
    }

    if (!token) {
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: "Token manquant", 
          error_en: "Missing token" 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("[get-bank-transfer-view] Validating token");

    // Validate token
    const { data: tokenData, error: tokenError } = await supabase
      .from("bank_transfer_view_tokens")
      .select("*")
      .eq("token", token)
      .single();

    if (tokenError || !tokenData) {
      console.log("[get-bank-transfer-view] Token not found");
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: "Lien invalide ou expiré", 
          error_en: "Invalid or expired link" 
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check expiration
    if (new Date(tokenData.expires_at) < new Date()) {
      console.log("[get-bank-transfer-view] Token expired");
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: "Ce lien a expiré. Veuillez en demander un nouveau.", 
          error_en: "This link has expired. Please request a new one." 
        }),
        { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get order details
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select(`
        id,
        total_usd,
        total_cdf,
        status,
        profiles!orders_user_id_fkey (
          full_name
        )
      `)
      .eq("id", tokenData.order_id)
      .single();

    if (orderError || !order) {
      console.error("[get-bank-transfer-view] Order not found:", orderError);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: "Commande introuvable", 
          error_en: "Order not found" 
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get bank transfer details from admin_settings
    const { data: bankSettings, error: bankError } = await supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "bank_transfer_details")
      .single();

    let bankDetails = {
      beneficiary_name: "AfriShop USA LLC",
      bank_name: "",
      account_number_or_iban: "",
      swift_bic: "",
      instructions_fr: "Mettez la référence dans le libellé du virement.",
      instructions_en: "Put the reference in the transfer description.",
      support_whatsapp: "",
      support_email: "nkadimisha@afrishop-usa.com",
    };

    if (bankSettings?.value) {
      try {
        const parsed = typeof bankSettings.value === "string" 
          ? JSON.parse(bankSettings.value) 
          : bankSettings.value;
        bankDetails = { ...bankDetails, ...parsed };
      } catch (e) {
        console.error("[get-bank-transfer-view] Error parsing bank settings:", e);
      }
    }

    // Also try to get from main settings table as fallback
    if (!bankDetails.bank_name || !bankDetails.account_number_or_iban) {
      const { data: mainSettings } = await supabase
        .from("settings")
        .select("bank_name, bank_account_holder, bank_account_number, bank_swift, bank_iban, support_email, support_whatsapp")
        .limit(1)
        .single();

      if (mainSettings) {
        if (!bankDetails.beneficiary_name && mainSettings.bank_account_holder) {
          bankDetails.beneficiary_name = mainSettings.bank_account_holder;
        }
        if (!bankDetails.bank_name && mainSettings.bank_name) {
          bankDetails.bank_name = mainSettings.bank_name;
        }
        if (!bankDetails.account_number_or_iban) {
          bankDetails.account_number_or_iban = mainSettings.bank_iban || mainSettings.bank_account_number || "";
        }
        if (!bankDetails.swift_bic && mainSettings.bank_swift) {
          bankDetails.swift_bic = mainSettings.bank_swift;
        }
        if (!bankDetails.support_email && mainSettings.support_email) {
          bankDetails.support_email = mainSettings.support_email;
        }
        if (!bankDetails.support_whatsapp && mainSettings.support_whatsapp) {
          bankDetails.support_whatsapp = mainSettings.support_whatsapp;
        }
      }
    }

    const profile = order.profiles as { full_name?: string } | null;
    const reference = generateReference(order.id);

    console.log("[get-bank-transfer-view] Returning order and bank details");

    return new Response(
      JSON.stringify({
        ok: true,
        order: {
          order_id: order.id,
          reference,
          amount_usd: order.total_usd,
          amount_cdf: order.total_cdf,
          currency: "USD",
          customer_name: profile?.full_name || null,
          status: order.status,
        },
        bank: bankDetails,
        expires_at: tokenData.expires_at,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[get-bank-transfer-view] Error:", error);
    return new Response(
      JSON.stringify({ 
        ok: false, 
        error: "Erreur serveur", 
        error_en: "Server error" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
