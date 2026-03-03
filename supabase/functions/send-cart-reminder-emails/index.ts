import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-cron-key",
};

function buildCartReminderEmail(params: {
  customerName: string;
  orderId: string;
  totalUsd: number;
  items: Array<{ title: string; quantity: number; image_url?: string }>;
  frontendUrl: string;
}) {
  const { customerName, orderId, totalUsd, items, frontendUrl } = params;
  const shortId = orderId.slice(0, 8).toUpperCase();
  const itemsList = items
    .map(
      (i) =>
        `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${i.title || "Product"}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">x${i.quantity}</td></tr>`
    )
    .join("");

  const subject = `🛒 Votre commande vous attend / Your order is waiting – ${shortId}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#374151;">
  <div style="max-width:600px;margin:0 auto;background:white;">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:30px;text-align:center;">
      <h1 style="color:white;margin:0;font-size:24px;">🛒 AfriShop USA</h1>
    </div>
    
    <div style="padding:30px;">
      <!-- French -->
      <p style="color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🇫🇷 Français</p>
      
      <h2 style="color:#1e3a5f;margin-top:0;">Bonjour ${customerName} 👋</h2>
      <p>Vous avez commencé une commande mais ne l'avez pas encore finalisée. Vos articles sont toujours disponibles et vous attendent !</p>
      
      <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">
        <p style="margin:0 0 8px 0;font-weight:600;">Commande #${shortId}</p>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr><th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Article</th><th style="padding:8px;text-align:center;border-bottom:2px solid #e5e7eb;">Qté</th></tr></thead>
          <tbody>${itemsList}</tbody>
        </table>
        <p style="margin:12px 0 0 0;font-weight:700;font-size:18px;">Total: $${totalUsd.toFixed(2)} USD</p>
      </div>
      
      <p>Finalisez votre achat maintenant avant que les prix ne changent :</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${frontendUrl}/orders" style="display:inline-block;padding:14px 32px;background:#2563eb;color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">Finaliser ma commande</a>
      </div>
      <p style="color:#6b7280;font-size:13px;">Si vous ne finalisez pas dans les 10 jours, votre commande sera automatiquement annulée.</p>
      
      <hr style="margin:25px 0;border:none;border-top:1px solid #e5e7eb;" />
      
      <!-- English -->
      <p style="color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🇬🇧 English</p>
      
      <h2 style="color:#1e3a5f;margin-top:0;">Hello ${customerName} 👋</h2>
      <p>You started an order but haven't completed it yet. Your items are still available and waiting for you!</p>
      
      <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">
        <p style="margin:0 0 8px 0;font-weight:600;">Order #${shortId}</p>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr><th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Item</th><th style="padding:8px;text-align:center;border-bottom:2px solid #e5e7eb;">Qty</th></tr></thead>
          <tbody>${itemsList}</tbody>
        </table>
        <p style="margin:12px 0 0 0;font-weight:700;font-size:18px;">Total: $${totalUsd.toFixed(2)} USD</p>
      </div>
      
      <p>Complete your purchase now before prices change:</p>
      <div style="text-align:center;margin:24px 0;">
        <a href="${frontendUrl}/orders" style="display:inline-block;padding:14px 32px;background:#2563eb;color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">Complete My Order</a>
      </div>
      <p style="color:#6b7280;font-size:13px;">If not completed within 10 days, your order will be automatically cancelled.</p>
    </div>
    
    <!-- Footer -->
    <div style="background:#1e3a5f;padding:20px;text-align:center;color:white;font-size:12px;">
      <p style="margin:0;">AfriShop USA – Shop from USA, Deliver to Africa</p>
      <p style="margin:4px 0 0 0;color:#94a3b8;">© ${new Date().getFullYear()} AfriShop. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;

  return { subject, html };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: accept internal cron key or service_role
    const cronKey = req.headers.get("x-internal-cron-key");
    const authHeader = req.headers.get("authorization");
    const validCronKey = "afrishop-internal-cron-2026";

    let isAuthorized = cronKey === validCronKey;

    if (!isAuthorized && authHeader) {
      // Check for service_role
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      isAuthorized = authHeader === `Bearer ${serviceKey}`;
    }

    if (!isAuthorized) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get frontend URL
    const { data: frontendSetting } = await supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "frontend_base_url")
      .single();

    const frontendUrl = frontendSetting?.value || Deno.env.get("FRONTEND_BASE_URL") || "https://afrishop-usa.com";

    // Find PENDING_PAYMENT orders > 48h old with no reminder sent and no active payment
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: orders, error: ordersErr } = await supabase
      .from("orders")
      .select(`
        id, total_usd, user_id, created_at,
        profiles(email, name, full_name),
        order_items(title, quantity, product_image_url)
      `)
      .eq("status", "PENDING_PAYMENT")
      .is("cart_reminder_sent_at", null)
      .lt("created_at", cutoff)
      .limit(50);

    if (ordersErr) {
      throw new Error(`Failed to fetch orders: ${ordersErr.message}`);
    }

    if (!orders || orders.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No orders need reminders", sent: 0 }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Filter out orders with active payment attempts
    const orderIds = orders.map((o: any) => o.id);
    const { data: activeAttempts } = await supabase
      .from("payment_attempts")
      .select("order_id")
      .in("order_id", orderIds)
      .in("status", ["pending", "paid"]);

    const activeOrderIds = new Set((activeAttempts || []).map((a: any) => a.order_id));
    const eligibleOrders = orders.filter((o: any) => !activeOrderIds.has(o.id));

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const order of eligibleOrders) {
      const profile = order.profiles as any;
      const email = profile?.email;
      if (!email) continue;

      const customerName = profile?.name || profile?.full_name || "Customer";
      const items = (order.order_items || []).map((i: any) => ({
        title: i.title || "Product",
        quantity: i.quantity || 1,
        image_url: i.product_image_url,
      }));

      const template = buildCartReminderEmail({
        customerName,
        orderId: order.id,
        totalUsd: Number(order.total_usd || 0),
        items,
        frontendUrl,
      });

      const result = await sendEmail({
        to: email,
        subject: template.subject,
        html: template.html,
        category: "cart_recovery",
      });

      if (result.success) {
        // Mark reminder as sent
        await supabase
          .from("orders")
          .update({ cart_reminder_sent_at: new Date().toISOString() })
          .eq("id", order.id);
        sent++;
      } else {
        failed++;
        errors.push(`${order.id}: ${result.error}`);
      }

      // Small delay between emails
      if (eligibleOrders.indexOf(order) < eligibleOrders.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    console.log(`[cart-reminder] Sent ${sent}, failed ${failed} out of ${eligibleOrders.length} eligible orders`);

    return new Response(
      JSON.stringify({
        success: true,
        total_eligible: eligibleOrders.length,
        sent,
        failed,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("[cart-reminder] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
