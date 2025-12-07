import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { sendEmail, DEFAULT_FROM_EMAIL } from "../_shared/email.ts";
import { buildOrderDeliveredEmail } from "../_shared/emailTemplates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DeliveryNotificationRequest {
  orderId: string;
  customerEmail: string;
  customerName: string;
  deliveredAt: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId, customerEmail, customerName, deliveredAt }: DeliveryNotificationRequest = await req.json();

    console.log(`Sending delivery notification for order ${orderId} to ${customerEmail}`);

    const template = buildOrderDeliveredEmail({
      customerName,
      orderId,
      deliveredAt,
    });

    const result = await sendEmail({
      to: customerEmail,
      subject: template.subject,
      html: template.html,
      category: "order_delivered",
    });

    console.log("Delivery notification email result:", result);

    return new Response(JSON.stringify({ success: result.success, id: result.id }), {
      status: result.success ? 200 : 500,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error sending delivery notification:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
