import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

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
    const fromAddress = Deno.env.get("EMAIL_FROM_ADDRESS") || "noreply@afrishop.com";
    
    const itemsList = items.map(i => `<li>${i.title} (x${i.quantity})</li>`).join('');

    const { data: emailData, error: emailError } = await resend.emails.send({
      from: `AfriShop <${fromAddress}>`,
      to: [customerEmail],
      subject: `✅ Votre commande #${orderRef} est arrivée / Your order has been delivered`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f5f5;">
          <div style="background: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            <div style="text-align: center; margin-bottom: 24px;">
              <h1 style="color: #16a34a; margin: 0;">✅ Commande Livrée!</h1>
              <p style="color: #666; margin: 8px 0 0 0;">Your order has been delivered!</p>
            </div>
            
            <p>Bonjour <strong>${customerName}</strong>,</p>
            
            <p>Votre commande <strong>#${orderRef}</strong> a été livrée avec succès!</p>
            <p style="color: #666; font-size: 14px;">Your order has been successfully delivered!</p>
            
            <div style="background: #f0fdf4; padding: 16px; border-radius: 8px; margin: 20px 0; border: 1px solid #bbf7d0;">
              <p style="margin: 0 0 8px 0; font-weight: bold;">📦 Articles livrés / Delivered items:</p>
              <ul style="margin: 0; padding-left: 20px;">${itemsList}</ul>
            </div>
            
            <p>Merci d'avoir fait vos achats avec AfriShop! 🎉</p>
            <p style="color: #666; font-size: 14px;">Thank you for shopping with AfriShop!</p>
            
            <div style="background: #fef3c7; padding: 16px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0; font-size: 14px;">
                <strong>Un problème avec votre commande?</strong><br>
                Contactez-nous à support@afrishop.com<br>
                <span style="color: #666;">Having an issue? Contact us at support@afrishop.com</span>
              </p>
            </div>
            
            <div style="text-align: center; margin-top: 32px; padding-top: 24px; border-top: 1px solid #eee;">
              <p style="color: #999; font-size: 12px; margin: 0;">
                AfriShop - USA → DRC E-commerce<br>
                Merci pour votre confiance!
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

    console.log("[send-order-delivered-email] Email sent:", emailData);

    return new Response(JSON.stringify({ success: true, emailId: emailData?.id }), {
      status: 200,
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
