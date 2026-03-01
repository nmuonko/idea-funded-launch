import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, ADMIN_EMAIL } from "../_shared/email.ts";
import { buildOrderAssistanceEmail, AssistanceEmailLanguage } from "../_shared/emailTemplates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_LANGUAGES: AssistanceEmailLanguage[] = ['en', 'fr', 'sw', 'ln', 'en_sw'];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Verify JWT and get claims
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub as string;

    // Check if user is admin
    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError || !roleData) {
      console.error("[send-order-assistance-email] Admin check failed:", roleError?.message);
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { orderId, language = 'fr' } = await req.json();

    if (!orderId) {
      return new Response(JSON.stringify({ error: "orderId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate language parameter
    const validatedLanguage: AssistanceEmailLanguage = VALID_LANGUAGES.includes(language as AssistanceEmailLanguage) 
      ? (language as AssistanceEmailLanguage) 
      : 'fr';

    // Fetch order with profile using service role for full access
    const serviceClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: order, error: orderError } = await serviceClient
      .from("orders")
      .select(`
        id,
        status,
        total_usd,
        user_id,
        profiles(name, email, full_name)
      `)
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) {
      console.error("[send-order-assistance-email] Order fetch error:", orderError?.message);
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if order is in incomplete status
    if (!["DRAFT", "PENDING_PAYMENT"].includes(order.status)) {
      return new Response(
        JSON.stringify({ error: "Email can only be sent for incomplete orders (DRAFT or PENDING_PAYMENT)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const profile = order.profiles as any;
    const customerEmail = profile?.email;
    const customerName = profile?.full_name || profile?.name || "Customer";

    if (!customerEmail) {
      return new Response(JSON.stringify({ error: "Customer email not found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get item count and support contact in parallel
    const [itemCountResult, supportContactResult] = await Promise.all([
      serviceClient
        .from("order_items")
        .select("*", { count: "exact", head: true })
        .eq("order_id", orderId)
        .eq("is_saved_for_later", false),
      serviceClient
        .from("settings")
        .select("support_whatsapp, support_email")
        .limit(1)
        .maybeSingle(),
    ]);

    const itemCount = itemCountResult.count || 0;
    const supportContact = supportContactResult.data;
    const supportWhatsapp = supportContact?.support_whatsapp || "243973141627";
    const supportEmail = supportContact?.support_email || "nkadimisha@afrishop-usa.com";

    // Get frontend base URL
    const frontendBaseUrl = Deno.env.get("FRONTEND_BASE_URL") || "https://afrishop-usa.com";

    // Build and send email with language and support contact
    const emailTemplate = buildOrderAssistanceEmail({
      customerName,
      orderId,
      itemCount,
      totalUsd: Number(order.total_usd || 0),
      frontendBaseUrl,
      language: validatedLanguage,
      supportWhatsapp,
      supportEmail,
    });

    const emailResult = await sendEmail({
      to: customerEmail,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
      category: "customer_email",
      replyTo: ADMIN_EMAIL,
    });

    if (!emailResult.success) {
      console.error("[send-order-assistance-email] Email send failed:", emailResult.error);
      return new Response(
        JSON.stringify({ error: "Failed to send email", details: emailResult.error }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log to customer_email_logs
    await serviceClient.from("customer_email_logs").insert({
      customer_id: order.user_id,
      customer_email: customerEmail,
      subject: emailTemplate.subject,
      body: emailTemplate.html,
      sent_by: userId,
      status: "sent",
    });

    console.log(`[send-order-assistance-email] Email sent in ${validatedLanguage} to ${customerEmail} for order ${orderId}`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Assistance email sent to ${customerEmail}`,
        language: validatedLanguage,
        emailId: emailResult.id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[send-order-assistance-email] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
