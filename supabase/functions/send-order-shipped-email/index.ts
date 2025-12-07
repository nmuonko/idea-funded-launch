import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { sendEmail, DEFAULT_FROM_EMAIL } from "../_shared/email.ts";
import { buildOrderShippedEmail } from "../_shared/emailTemplates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ShippedEmailRequest {
  orderId: string;
  orderRef?: string;
  customerEmail: string;
  customerName: string;
  items: Array<{ title: string; quantity: number }>;
  trackingNumber?: string;
  carrier?: string;
  estimatedDelivery?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId, orderRef: providedRef, customerEmail, customerName, items, trackingNumber, carrier, estimatedDelivery }: ShippedEmailRequest = await req.json();
    
    console.log('[send-order-shipped-email] Sending to:', customerEmail);
    
    const orderRef = providedRef || orderId.substring(0, 8).toUpperCase();
    
    const template = buildOrderShippedEmail({
      customerName,
      orderId,
      items,
      trackingNumber,
      carrier,
      estimatedDelivery,
    });

    const result = await sendEmail({
      to: customerEmail,
      subject: `🚚 Votre commande #${orderRef} est en cours d'expédition / Your order is on its way`,
      html: template.html,
      category: "order_shipped",
    });

    console.log("[send-order-shipped-email] Result:", result);

    return new Response(JSON.stringify({ success: result.success, emailId: result.id }), {
      status: result.success ? 200 : 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("[send-order-shipped-email] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
