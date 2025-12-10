import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { sendEmail } from "../_shared/email.ts";
import { buildOrderProcessingEmail } from "../_shared/emailTemplates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProcessingEmailRequest {
  orderId: string;
  customerEmail: string;
  customerName: string;
  items: Array<{ title: string; quantity: number }>;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId, customerEmail, customerName, items }: ProcessingEmailRequest = await req.json();
    
    console.log('[send-order-processing-email] Sending to:', customerEmail);
    
    const template = buildOrderProcessingEmail({
      customerName,
      orderId,
      items,
    });

    const result = await sendEmail({
      to: customerEmail,
      subject: template.subject,
      html: template.html,
      category: "order_status_update",
    });

    console.log("[send-order-processing-email] Result:", result);

    return new Response(JSON.stringify({ success: result.success, emailId: result.id }), {
      status: result.success ? 200 : 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("[send-order-processing-email] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
