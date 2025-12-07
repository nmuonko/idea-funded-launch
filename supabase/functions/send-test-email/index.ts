import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { sendEmail, DEFAULT_FROM_EMAIL } from "../_shared/email.ts";
import { buildTestEmail } from "../_shared/emailTemplates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TestEmailRequest {
  to: string;
  name?: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { to, name }: TestEmailRequest = await req.json();

    if (!to) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing 'to' email address" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[send-test-email] Sending test email to ${to}`);

    const template = buildTestEmail(name);
    const result = await sendEmail({
      to,
      subject: template.subject,
      html: template.html,
      category: "test",
    });

    if (result.success) {
      console.log(`[send-test-email] Successfully sent test email, ID: ${result.id}`);
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Test email sent successfully",
          emailId: result.id,
          from: DEFAULT_FROM_EMAIL,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      console.error(`[send-test-email] Failed to send:`, result.error);
      return new Response(
        JSON.stringify({ success: false, error: result.error }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error: any) {
    console.error("[send-test-email] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
