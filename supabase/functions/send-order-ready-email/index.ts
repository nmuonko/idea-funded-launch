import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { sendEmail } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ReadyEmailRequest {
  orderId: string;
  customerEmail: string;
  customerName: string;
  items: Array<{ title: string; quantity: number }>;
  pickupLocation?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { orderId, customerEmail, customerName, items, pickupLocation }: ReadyEmailRequest = await req.json();
    
    console.log('[send-order-ready-email] Sending to:', customerEmail);
    
    const orderRef = orderId.substring(0, 8).toUpperCase();
    
    const itemsList = items.map(i => `<li>${i.title} (x${i.quantity})</li>`).join('');
    const locationText = pickupLocation || 'notre point de collecte / our pickup point';
    
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #374151; margin: 0; padding: 0;">
  <div style="max-width: 600px; margin: 0 auto;">
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 30px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 24px;">📦 Prêt pour le ramassage!</h1>
      <p style="color: #93c5fd; margin: 8px 0 0;">Ready for Pickup!</p>
    </div>
    
    <div style="padding: 30px; background: #ffffff;">
      <p>Bonjour <strong>${customerName}</strong>,</p>
      
      <p>Votre commande <strong>#${orderRef}</strong> est arrivée et prête pour le ramassage à <strong>${locationText}</strong>.</p>
      <p style="color: #6b7280; font-size: 14px;">Your order <strong>#${orderRef}</strong> has arrived and is ready for pickup at <strong>${locationText}</strong>.</p>
      
      <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 16px; margin: 20px 0;">
        <h3 style="margin: 0 0 8px; color: #166534;">Articles / Items:</h3>
        <ul style="margin: 0; padding-left: 20px;">${itemsList}</ul>
      </div>
      
      <p style="font-weight: 600;">Veuillez récupérer votre commande dès que possible.</p>
      <p style="color: #6b7280; font-size: 14px;">Please collect your order at your earliest convenience.</p>
    </div>
    
    <div style="background: #1e3a5f; padding: 20px; text-align: center; color: white; font-size: 12px;">
      <p style="margin: 0;">AfriShop — Shopping sans frontières 🌍</p>
    </div>
  </div>
</body>
</html>`;

    const result = await sendEmail({
      to: customerEmail,
      subject: `📦 Commande #${orderRef} prête pour le ramassage / Ready for pickup`,
      html,
      category: "order_ready_pickup",
    });

    console.log("[send-order-ready-email] Result:", result);

    return new Response(JSON.stringify({ success: result.success, emailId: result.id }), {
      status: result.success ? 200 : 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("[send-order-ready-email] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
