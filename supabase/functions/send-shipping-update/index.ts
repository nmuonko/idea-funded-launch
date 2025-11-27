import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ShippingUpdateRequest {
  orderId: string;
  customerEmail: string;
  customerName: string;
  trackingNumber?: string;
  carrier?: string;
  estimatedDelivery?: string;
  status: 'shipped' | 'in_transit' | 'out_for_delivery';
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      orderId, 
      customerEmail, 
      customerName, 
      trackingNumber, 
      carrier,
      estimatedDelivery,
      status
    }: ShippingUpdateRequest = await req.json();

    console.log(`Sending shipping update for order ${orderId} to ${customerEmail}`);

    const statusMessages = {
      shipped: 'Your order has been shipped!',
      in_transit: 'Your order is on its way!',
      out_for_delivery: 'Your order is out for delivery!'
    };

    const statusMessage = statusMessages[status] || 'Shipping Update';

    const trackingHtml = trackingNumber ? `
      <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 5px 0; color: #374151;"><strong>Tracking Number:</strong> ${trackingNumber}</p>
        ${carrier ? `<p style="margin: 5px 0; color: #374151;"><strong>Carrier:</strong> ${carrier}</p>` : ''}
      </div>
    ` : '';

    const deliveryHtml = estimatedDelivery ? `
      <p style="font-size: 16px; color: #374151;">
        <strong>Estimated Delivery:</strong> ${new Date(estimatedDelivery).toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        })}
      </p>
    ` : '';

    const emailResponse = await resend.emails.send({
      from: Deno.env.get("EMAIL_FROM_ADDRESS") || "AfriShop <orders@afrishop.com>",
      to: [customerEmail],
      subject: `${statusMessage} - Order ${orderId}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #1e40af 0%, #0ea5e9 100%); padding: 30px; text-align: center;">
            <h1 style="color: white; margin: 0;">${statusMessage}</h1>
          </div>
          
          <div style="padding: 30px; background: #f9fafb;">
            <p style="font-size: 16px; color: #374151;">Hi ${customerName},</p>
            <p style="font-size: 16px; color: #374151;">Great news! Your order is on its way to you.</p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h2 style="color: #1e40af; margin-top: 0;">Shipping Details</h2>
              <p style="color: #6b7280; margin: 5px 0;"><strong>Order ID:</strong> ${orderId}</p>
              
              ${trackingHtml}
              ${deliveryHtml}
            </div>
            
            <p style="font-size: 14px; color: #6b7280;">
              You can track your order using the tracking number above. We'll notify you once your order has been delivered.
            </p>
            
            <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">
              Best regards,<br>
              <strong>AfriShop Team</strong>
            </p>
          </div>
          
          <div style="background: #1e40af; padding: 20px; text-align: center;">
            <p style="color: white; margin: 0; font-size: 12px;">© 2024 AfriShop. All rights reserved.</p>
          </div>
        </div>
      `,
    });

    console.log("Shipping update email sent:", emailResponse);

    return new Response(JSON.stringify(emailResponse), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    console.error("Error sending shipping update:", error);
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
