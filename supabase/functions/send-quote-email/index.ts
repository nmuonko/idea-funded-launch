import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { sendEmail, DEFAULT_FROM_EMAIL } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QuoteEmailRequest {
  quoteRequestId: string;
  quotedShippingUsd: number;
  quotedTotalUsd: number;
  adminNotes?: string;
}

const handler = async (req: Request): Promise<Response> => {
  console.log("[send-quote-email] Received request");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { quoteRequestId, quotedShippingUsd, quotedTotalUsd, adminNotes }: QuoteEmailRequest = await req.json();

    console.log("[send-quote-email] Processing quote:", quoteRequestId);

    // Fetch quote request with user info
    const { data: quoteRequest, error: quoteError } = await supabase
      .from("quote_requests")
      .select("*, order_item_id, user_id, title, product_url, store_name")
      .eq("id", quoteRequestId)
      .single();

    if (quoteError || !quoteRequest) {
      console.error("[send-quote-email] Quote not found:", quoteError);
      return new Response(
        JSON.stringify({ error: "Quote request not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the order_id from the order_item
    const { data: orderItem, error: itemError } = await supabase
      .from("order_items")
      .select("order_id")
      .eq("id", quoteRequest.order_item_id)
      .single();

    if (itemError || !orderItem) {
      console.error("[send-quote-email] Order item not found:", itemError);
      return new Response(
        JSON.stringify({ error: "Order item not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch user email
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("email, full_name, name")
      .eq("user_id", quoteRequest.user_id)
      .single();

    if (profileError || !profile?.email) {
      console.error("[send-quote-email] User profile not found:", profileError);
      return new Response(
        JSON.stringify({ error: "User email not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const customerName = profile.full_name || profile.name || "Customer";
    const vehicleTitle = quoteRequest.title || "Vehicle";
    const storeName = quoteRequest.store_name || "Online Store";
    const frontendBaseUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';

    // Link directly to web cart page for payment (supports Mobile Money & Card)
    const paymentUrl = `${frontendBaseUrl}/cart`;

    console.log("[send-quote-email] Payment URL:", paymentUrl);

    const formatUSD = (amount: number) => `$${amount.toFixed(2)} USD`;

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  
  <!-- Header -->
  <div style="text-align: center; padding: 20px 0; border-bottom: 2px solid #1e3a5f;">
    <h1 style="color: #1e3a5f; margin: 0; font-size: 28px;">AfriShop USA</h1>
    <p style="color: #666; margin: 5px 0 0;">USA → DRC</p>
  </div>

  <!-- English Section -->
  <div style="padding: 30px 0; border-bottom: 1px solid #eee;">
    <h2 style="color: #1e3a5f; margin-top: 0;">🚗 Your Vehicle Quote is Ready!</h2>
    
    <p>Hello ${customerName},</p>
    
    <p>Great news! We have prepared a custom quote for your vehicle order:</p>
    
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: white; padding: 25px; border-radius: 12px; margin: 20px 0;">
      <h3 style="margin: 0 0 15px; font-size: 18px;">${vehicleTitle}</h3>
      <p style="margin: 5px 0; opacity: 0.9;">From: ${storeName}</p>
      
      <div style="background: rgba(255,255,255,0.15); padding: 15px; border-radius: 8px; margin-top: 15px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.2);">Shipping Cost:</td>
            <td style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.2); text-align: right; font-weight: bold;">${formatUSD(quotedShippingUsd)}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; font-size: 20px; font-weight: bold;">Total Price:</td>
            <td style="padding: 12px 0; text-align: right; font-size: 24px; font-weight: bold;">${formatUSD(quotedTotalUsd)}</td>
          </tr>
        </table>
      </div>
    </div>
    
    ${adminNotes ? `<p style="background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid #1e3a5f;"><strong>Note from our team:</strong> ${adminNotes}</p>` : ''}
    
    <p>To proceed with your purchase, click the button below to view your quote and pay online:</p>
    
    <div style="text-align: center; margin: 25px 0;">
      <a href="${paymentUrl}" style="display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 16px 40px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 18px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
        💳 View Quote &amp; Pay
      </a>
    </div>
  </div>

  <!-- French Section -->
  <div style="padding: 30px 0;">
    <h2 style="color: #1e3a5f; margin-top: 0;">🚗 Votre devis véhicule est prêt !</h2>
    
    <p>Bonjour ${customerName},</p>
    
    <p>Bonne nouvelle ! Nous avons préparé un devis personnalisé pour votre commande de véhicule :</p>
    
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); color: white; padding: 25px; border-radius: 12px; margin: 20px 0;">
      <h3 style="margin: 0 0 15px; font-size: 18px;">${vehicleTitle}</h3>
      <p style="margin: 5px 0; opacity: 0.9;">De: ${storeName}</p>
      
      <div style="background: rgba(255,255,255,0.15); padding: 15px; border-radius: 8px; margin-top: 15px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.2);">Frais de livraison :</td>
            <td style="padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.2); text-align: right; font-weight: bold;">${formatUSD(quotedShippingUsd)}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; font-size: 20px; font-weight: bold;">Prix total :</td>
            <td style="padding: 12px 0; text-align: right; font-size: 24px; font-weight: bold;">${formatUSD(quotedTotalUsd)}</td>
          </tr>
        </table>
      </div>
    </div>
    
    ${adminNotes ? `<p style="background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid #1e3a5f;"><strong>Note de notre équipe :</strong> ${adminNotes}</p>` : ''}
    
    <p>Pour finaliser votre achat, cliquez sur le bouton ci-dessous pour voir votre devis et payer en ligne :</p>
    
    <div style="text-align: center; margin: 25px 0;">
      <a href="${paymentUrl}" style="display: inline-block; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 16px 40px; border-radius: 8px; text-decoration: none; font-weight: bold; font-size: 18px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
        💳 Voir le devis et payer
      </a>
    </div>
  </div>

  <!-- Footer -->
  <div style="text-align: center; padding: 20px; border-top: 1px solid #eee; color: #666; font-size: 14px;">
    <p style="margin: 0;">AfriShop USA - Your Gateway to American Products</p>
    <p style="margin: 5px 0;">© ${new Date().getFullYear()} AfriShop USA. All rights reserved.</p>
  </div>
  
</body>
</html>
    `;

    const result = await sendEmail({
      to: profile.email,
      subject: `🚗 Your Vehicle Quote is Ready / Votre devis véhicule est prêt - ${formatUSD(quotedTotalUsd)}`,
      html: emailHtml,
      category: "quote_request",
    });

    console.log("[send-quote-email] Email result:", result);

    // Send push notification to user's devices
    try {
      const pushResponse = await fetch(
        `${supabaseUrl}/functions/v1/send-push-notification`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            userId: quoteRequest.user_id,
            title: '🚗 Votre devis est prêt!',
            body: `Devis pour ${vehicleTitle}: ${formatUSD(quotedTotalUsd)}`,
            data: {
              type: 'quote_ready',
              quoteRequestId: quoteRequestId,
              quotedTotalUsd: quotedTotalUsd,
            },
          }),
        }
      );

      if (pushResponse.ok) {
        const pushResult = await pushResponse.json();
        console.log("[send-quote-email] Push notification result:", pushResult);
      } else {
        console.error("[send-quote-email] Push notification failed:", await pushResponse.text());
      }
    } catch (pushError) {
      console.error("[send-quote-email] Push notification error:", pushError);
      // Don't fail the request if push fails
    }

    return new Response(
      JSON.stringify({ success: result.success, emailId: result.id, paymentUrl }),
      { status: result.success ? 200 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[send-quote-email] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
