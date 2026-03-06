import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "@supabase/supabase-js";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QuoteResponseRequest {
  quoteRequestId: string;
  response: "ACCEPTED" | "REJECTED";
  customerEmail: string;
  customerName: string;
  vehicleTitle: string;
  quotedTotalUsd: number;
}

const handler = async (req: Request): Promise<Response> => {
  console.log("[send-quote-response-notification] Received request");

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { quoteRequestId, response, customerEmail, customerName, vehicleTitle, quotedTotalUsd }: QuoteResponseRequest = await req.json();

    console.log("[send-quote-response-notification] Processing:", { quoteRequestId, response });

    const adminEmail = Deno.env.get("ADMIN_NOTIFICATION_EMAIL") || "admin@afrishop.com";
    const responseText = response === "ACCEPTED" ? "ACCEPTED" : "REJECTED";
    const responseEmoji = response === "ACCEPTED" ? "✅" : "❌";
    const responseColor = response === "ACCEPTED" ? "#10b981" : "#ef4444";

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Vehicle Quote ${responseText}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  
  <div style="text-align: center; padding: 20px 0; border-bottom: 2px solid #1e40af;">
    <h1 style="color: #1e40af; margin: 0;">AfriShop Admin</h1>
  </div>

  <div style="padding: 30px 0;">
    <h2 style="color: ${responseColor}; margin-top: 0;">${responseEmoji} Vehicle Quote ${responseText}</h2>
    
    <p>A customer has responded to a vehicle quote:</p>
    
    <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Customer:</strong></td>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${customerName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Email:</strong></td>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${customerEmail}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Vehicle:</strong></td>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">${vehicleTitle}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;"><strong>Quoted Total:</strong></td>
          <td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">$${quotedTotalUsd.toFixed(2)} USD</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Response:</strong></td>
          <td style="padding: 8px 0; color: ${responseColor}; font-weight: bold;">${responseText}</td>
        </tr>
      </table>
    </div>

    ${response === "ACCEPTED" ? `
    <p style="background: #d1fae5; padding: 15px; border-radius: 8px; color: #065f46;">
      <strong>Next Steps:</strong> The customer has accepted the quote. Please proceed with order processing when payment is received.
    </p>
    ` : `
    <p style="background: #fee2e2; padding: 15px; border-radius: 8px; color: #991b1b;">
      <strong>Note:</strong> The customer has rejected this quote. You may want to follow up with a revised offer.
    </p>
    `}
    
    <p style="margin-top: 20px;">
      <a href="https://afrishop.lovable.app/admin/quote-requests" style="display: inline-block; background: #1e40af; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">View Quote Requests</a>
    </p>
  </div>

  <div style="text-align: center; padding: 20px; border-top: 1px solid #eee; color: #666; font-size: 14px;">
    <p style="margin: 0;">AfriShop Admin Notification</p>
  </div>
  
</body>
</html>
    `;

    const emailResponse = await resend.emails.send({
      from: "AfriShop <notifications@resend.dev>",
      to: [adminEmail],
      subject: `${responseEmoji} Quote ${responseText}: ${vehicleTitle} - ${customerName}`,
      html: emailHtml,
    });

    console.log("[send-quote-response-notification] Email sent:", emailResponse);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("[send-quote-response-notification] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
