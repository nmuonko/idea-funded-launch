import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

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

    const emailResponse = await resend.emails.send({
      from: Deno.env.get("EMAIL_FROM_ADDRESS") || "AfriShop <orders@afrishop.com>",
      to: [customerEmail],
      subject: `Order Delivered - ${orderId}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #059669 0%, #10b981 100%); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0;">✓ Order Delivered!</h1>
          </div>
          
          <div style="padding: 30px; background: #f9fafb;">
            <p style="font-size: 16px; color: #374151;">Hi ${customerName},</p>
            <p style="font-size: 16px; color: #374151;">Your order has been successfully delivered!</p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h2 style="color: #059669; margin-top: 0;">Delivery Confirmed</h2>
              <p style="color: #6b7280; margin: 5px 0;"><strong>Order ID:</strong> ${orderId}</p>
              <p style="color: #6b7280; margin: 5px 0;">
                <strong>Delivered on:</strong> ${new Date(deliveredAt).toLocaleDateString('en-US', { 
                  weekday: 'long', 
                  year: 'numeric', 
                  month: 'long', 
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </p>
            </div>
            
            <div style="background: #f0fdf4; padding: 15px; border-radius: 8px; border-left: 4px solid #059669; margin: 20px 0;">
              <p style="margin: 0; color: #374151; font-size: 14px;">
                <strong>We hope you love your purchase!</strong><br>
                If you have any questions or concerns about your order, please don't hesitate to contact us.
              </p>
            </div>
            
            <p style="font-size: 14px; color: #6b7280;">
              Thank you for shopping with AfriShop. We look forward to serving you again!
            </p>
            
            <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
              Best regards,<br>
              <strong>AfriShop Team</strong>
            </p>
          </div>
          
          <div style="background: #059669; padding: 20px; text-align: center;">
            <p style="color: white; margin: 0; font-size: 12px;">© 2024 AfriShop. All rights reserved.</p>
          </div>
        </div>
      `,
    });

    console.log("Delivery notification email sent:", emailResponse);

    return new Response(JSON.stringify(emailResponse), {
      status: 200,
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
