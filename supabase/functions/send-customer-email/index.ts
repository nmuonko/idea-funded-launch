import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, DEFAULT_FROM_EMAIL } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// HTML escape function to prevent XSS in email content
function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEntities[char] || char);
}

interface SendEmailRequest {
  customer_id: string;
  customer_email: string;
  subject: string;
  body: string;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      console.error("[send-customer-email] No authorization header");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify admin user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error("[send-customer-email] Auth error:", authError);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check admin role
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .single();

    if (!roleData) {
      console.error("[send-customer-email] User is not admin:", user.id);
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { customer_id, customer_email, subject, body }: SendEmailRequest = await req.json();

    if (!customer_email || !subject || !body) {
      console.error("[send-customer-email] Missing required fields");
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[send-customer-email] Sending email to ${customer_email}`);

    // Sanitize body content to prevent XSS - escape HTML entities before converting newlines
    const sanitizedBody = escapeHtml(body).replace(/\n/g, '<br>');

    const emailHtml = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: white; margin: 0; font-size: 24px;">AfriShop USA</h1>
        </div>
        <div style="padding: 30px; background: #f9fafb;">
          ${sanitizedBody}
        </div>
        <div style="padding: 20px; text-align: center; color: #6b7280; font-size: 12px; background: #1e3a5f; border-radius: 0 0 8px 8px;">
          <p style="margin: 0; color: white;">© ${new Date().getFullYear()} AfriShop USA. All rights reserved.</p>
        </div>
      </div>
    `;

    const result = await sendEmail({
      to: customer_email,
      subject: subject,
      html: emailHtml,
      category: "customer_email",
    });

    console.log("[send-customer-email] Result:", result);

    // Log the email
    const { error: logError } = await supabase.from("customer_email_logs").insert({
      customer_id: customer_id,
      customer_email: customer_email,
      subject: subject,
      body: body,
      sent_by: user.id,
      status: result.success ? "sent" : "failed",
    });

    if (logError) {
      console.error("[send-customer-email] Error logging email:", logError);
    }

    return new Response(JSON.stringify({ success: result.success, id: result.id }), {
      status: result.success ? 200 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("[send-customer-email] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
