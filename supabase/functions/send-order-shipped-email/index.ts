import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ShippedEmailRequest {
  orderId: string;
  customerEmail: string;
  customerName: string;
  items: Array<{ title: string; quantity: number }>;
  trackingNumber?: string;
  carrier?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId, customerEmail, customerName, items, trackingNumber, carrier }: ShippedEmailRequest = await req.json();
    
    console.log('[send-order-shipped-email] Sending to:', customerEmail);
    
    const orderRef = orderId.substring(0, 8).toUpperCase();
    const fromAddress = Deno.env.get("EMAIL_FROM_ADDRESS") || "noreply@afrishop.com";
    
    const itemsList = items.map(i => `<li>${i.title} (x${i.quantity})</li>`).join('');
    
    const trackingSection = trackingNumber ? `
      <div style="background: #f0f9ff; padding: 16px; border-radius: 8px; margin: 20px 0;">
        <p style="margin: 0; font-weight: bold;">📦 Suivi de colis / Tracking:</p>
        ${carrier ? `<p style="margin: 8px 0 0 0;">Transporteur: ${carrier}</p>` : ''}
        <p style="margin: 8px 0 0 0;">Numéro: <strong>${trackingNumber}</strong></p>
      </div>
    ` : '';

    const { data: emailData, error: emailError } = await resend.emails.send({
      from: `AfriShop <${fromAddress}>`,
      to: [customerEmail],
      subject: `🚚 Votre commande #${orderRef} est en cours d'expédition / Your order is on its way`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f5f5;">
          <div style="background: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 24px;">
              <h1 style="color: #2563eb; margin: 0;">🚚 Commande Expédiée!</h1>
              <p style="color: #666; margin: 8px 0 0 0;">Your order is on its way!</p>
            </div>
            
            <p>Bonjour <strong>${customerName}</strong>,</p>
            
            <p>Bonne nouvelle! Votre commande <strong>#${orderRef}</strong> a été expédiée et est en route vers vous.</p>
            <p style="color: #666; font-size: 14px;">Great news! Your order has been shipped and is on its way to you.</p>
            
            ${trackingSection}
            
            <div style="background: #f8f9fa; padding: 16px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0 0 8px 0; font-weight: bold;">Articles expédiés / Items shipped:</p>
              <ul style="margin: 0; padding-left: 20px;">${itemsList}</ul>
            </div>
            
            <p style="color: #666; font-size: 14px;">
              Vous recevrez un email dès que votre commande sera arrivée à destination.<br>
              You will receive another email once your order has been delivered.
            </p>
            
            <div style="text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid #eee;">
              <p style="color: #999; font-size: 12px; margin: 0;">
                AfriShop - USA → DRC E-commerce<br>
                Questions? Contact support@afrishop.com
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
    });

    if (emailError) {
      throw emailError;
    }

    console.log("[send-order-shipped-email] Email sent:", emailData);

    return new Response(JSON.stringify({ success: true, emailId: emailData?.id }), {
      status: 200,
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
