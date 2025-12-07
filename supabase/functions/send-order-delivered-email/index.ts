import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { sendEmail, DEFAULT_FROM_EMAIL } from "../_shared/email.ts";
import { buildOrderDeliveredEmail } from "../_shared/emailTemplates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DeliveredEmailRequest {
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
    const { orderId, customerEmail, customerName, items }: DeliveredEmailRequest = await req.json();
    
    console.log('[send-order-delivered-email] Sending to:', customerEmail);
    
    const orderRef = orderId.substring(0, 8).toUpperCase();
    
    const template = buildOrderDeliveredEmail({
      customerName,
      orderId,
      deliveredAt: new Date().toISOString(),
    });

    const result = await sendEmail({
      to: customerEmail,
      subject: `✅ Votre commande #${orderRef} est arrivée / Your order has been delivered`,
      html: template.html,
      category: "order_delivered",
    });

    console.log("[send-order-delivered-email] Result:", result);

    return new Response(JSON.stringify({ success: result.success, emailId: result.id }), {
      status: result.success ? 200 : 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("[send-order-delivered-email] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
