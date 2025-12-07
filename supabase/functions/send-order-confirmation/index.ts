import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { sendEmail, DEFAULT_FROM_EMAIL } from "../_shared/email.ts";
import { buildOrderConfirmationEmail } from "../_shared/emailTemplates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OrderConfirmationRequest {
  orderId: string;
  customerEmail: string;
  customerName: string;
  orderTotal: number;
  orderItems: Array<{
    title: string;
    quantity: number;
    price: number;
  }>;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId, customerEmail, customerName, orderTotal, orderItems }: OrderConfirmationRequest = await req.json();

    console.log(`[send-order-confirmation] Sending to ${customerEmail} for order ${orderId}`);

    const template = buildOrderConfirmationEmail({
      customerName,
      orderId,
      orderRef: orderId.substring(0, 8).toUpperCase(),
      items: orderItems,
      totalUsd: orderTotal,
    });

    const result = await sendEmail({
      to: customerEmail,
      subject: template.subject,
      html: template.html,
      category: "order_confirmation",
    });

    console.log("[send-order-confirmation] Result:", result);

    return new Response(JSON.stringify({ success: result.success, id: result.id }), {
      status: result.success ? 200 : 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("[send-order-confirmation] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
