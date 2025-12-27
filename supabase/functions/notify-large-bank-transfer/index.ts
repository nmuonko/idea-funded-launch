import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getCorsHeaders, handleCors } from "../_shared/http.ts";

const LARGE_TRANSFER_THRESHOLD_USD = 1000;

interface NotificationPayload {
  order_id: string;
  reference: string;
  amount_usd: number;
  amount_cdf?: number;
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders();
  
  if (req.method === "OPTIONS") return handleCors();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const adminEmail = Deno.env.get("ADMIN_NOTIFICATION_EMAIL");
    const fromEmail = Deno.env.get("EMAIL_FROM_ADDRESS") || "AfriShop <noreply@afrishop-usa.com>";

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const payload: NotificationPayload = await req.json();
    const { 
      order_id, 
      reference, 
      amount_usd, 
      amount_cdf,
      customer_name, 
      customer_email, 
      customer_phone 
    } = payload;

    // Only notify for large transfers
    if (amount_usd < LARGE_TRANSFER_THRESHOLD_USD) {
      return new Response(
        JSON.stringify({ 
          ok: true, 
          skipped: true, 
          reason: "Amount below threshold" 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!resendApiKey || !adminEmail) {
      console.warn("Missing RESEND_API_KEY or ADMIN_NOTIFICATION_EMAIL");
      return new Response(
        JSON.stringify({ 
          ok: true, 
          skipped: true, 
          reason: "Email not configured" 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build email content
    const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9fafb; padding: 24px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px; }
            .alert-box { background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
            .detail-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e5e7eb; }
            .detail-label { color: #6b7280; }
            .detail-value { font-weight: 600; }
            .amount { font-size: 24px; color: #059669; font-weight: bold; }
            .reference { font-family: monospace; background: #e5e7eb; padding: 8px 12px; border-radius: 4px; font-size: 14px; }
            .cta-button { display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; margin-top: 16px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🏦 Large Bank Transfer Initiated</h1>
            </div>
            <div class="content">
              <div class="alert-box">
                <strong>⚠️ Action Required:</strong> A customer has initiated a large bank transfer payment. Please monitor for incoming funds and verify upon receipt.
              </div>
              
              <div style="text-align: center; margin: 24px 0;">
                <p style="margin: 0; color: #6b7280;">Amount to Receive</p>
                <p class="amount">$${amount_usd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                ${amount_cdf ? `<p style="margin: 4px 0; color: #6b7280;">(${amount_cdf.toLocaleString()} CDF)</p>` : ''}
              </div>

              <div style="text-align: center; margin: 20px 0;">
                <p style="margin: 0 0 8px 0; color: #6b7280;">Payment Reference</p>
                <span class="reference">${reference}</span>
              </div>

              <h3 style="margin-top: 24px;">Customer Details</h3>
              <div class="detail-row">
                <span class="detail-label">Name</span>
                <span class="detail-value">${customer_name || 'Not provided'}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Email</span>
                <span class="detail-value">${customer_email || 'Not provided'}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Phone</span>
                <span class="detail-value">${customer_phone || 'Not provided'}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Order ID</span>
                <span class="detail-value" style="font-family: monospace; font-size: 12px;">${order_id}</span>
              </div>

              <div style="text-align: center; margin-top: 24px;">
                <a href="${Deno.env.get("FRONTEND_BASE_URL") || "https://afrishop-usa.com"}/admin/payments" class="cta-button">
                  View in Admin Dashboard
                </a>
              </div>

              <p style="margin-top: 24px; color: #6b7280; font-size: 14px; text-align: center;">
                Once the transfer is received, please confirm the payment in the admin dashboard to process the order.
              </p>
            </div>
          </div>
        </body>
      </html>
    `;

    // Send email via Resend
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: adminEmail,
        subject: `🏦 Large Bank Transfer: $${amount_usd.toLocaleString()} - ${reference}`,
        html: emailHtml,
      }),
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      console.error("Resend API error:", errorText);
      throw new Error(`Email send failed: ${emailResponse.status}`);
    }

    const emailResult = await emailResponse.json();

    // Log the notification
    await supabase.from("system_audit_log").insert({
      trace_id: crypto.randomUUID(),
      event_type: "LARGE_BANK_TRANSFER_NOTIFICATION",
      order_id,
      payload: {
        reference,
        amount_usd,
        amount_cdf,
        customer_email,
        email_id: emailResult.id,
      },
    });

    return new Response(
      JSON.stringify({ 
        ok: true, 
        email_id: emailResult.id,
        notified_to: adminEmail 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error in notify-large-bank-transfer:", error);
    const corsHeaders = getCorsHeaders();
    return new Response(
      JSON.stringify({ 
        ok: false, 
        error: error instanceof Error ? error.message : "Unknown error"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
