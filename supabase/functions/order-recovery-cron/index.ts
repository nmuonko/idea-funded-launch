import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const CRON_SECRET = "afrishop-internal-cron-2026";
const MAX_EMAILS_PER_RUN = 20;
const THROTTLE_MS = 600;

// ── Email templates ──────────────────────────────────────────────

function buildReminder1(p: {
  name: string; orderId: string; totalUsd: number;
  items: { title: string; quantity: number }[];
  frontendUrl: string; whatsapp?: string; supportEmail?: string;
}) {
  const shortId = p.orderId.slice(0, 8).toUpperCase();
  const itemsHtml = p.items.map(i =>
    `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${i.title}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">x${i.quantity}</td></tr>`
  ).join("");

  const contactBlock = [
    p.whatsapp ? `<a href="https://wa.me/${p.whatsapp}" style="color:#2563eb;">WhatsApp</a>` : null,
    p.supportEmail ? `<a href="mailto:${p.supportEmail}" style="color:#2563eb;">${p.supportEmail}</a>` : null,
  ].filter(Boolean).join(" · ");

  const subject = `🛒 Votre commande vous attend / Your order is waiting – ${shortId}`;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#374151;">
<div style="max-width:600px;margin:0 auto;background:white;">
  <div style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);padding:30px;text-align:center;">
    <h1 style="color:white;margin:0;font-size:24px;">🛒 AfriShop USA</h1>
  </div>
  <div style="padding:30px;">
    <p style="color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🇫🇷 Français</p>
    <h2 style="color:#1e3a5f;margin-top:0;">Bonjour ${p.name} 👋</h2>
    <p>Vous avez commencé une commande mais ne l'avez pas encore finalisée. Vos articles sont toujours disponibles !</p>
    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;font-weight:600;">Commande #${shortId}</p>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr><th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Article</th><th style="padding:8px;text-align:center;border-bottom:2px solid #e5e7eb;">Qté</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p style="margin:12px 0 0;font-weight:700;font-size:18px;">Total: $${p.totalUsd.toFixed(2)} USD</p>
    </div>
    <div style="text-align:center;margin:24px 0;">
      <a href="${p.frontendUrl}/orders" style="display:inline-block;padding:14px 32px;background:#2563eb;color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">Finaliser ma commande</a>
    </div>
    ${contactBlock ? `<p style="color:#6b7280;font-size:13px;">Besoin d'aide ? ${contactBlock}</p>` : ""}

    <hr style="margin:25px 0;border:none;border-top:1px solid #e5e7eb;" />

    <p style="color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🇬🇧 English</p>
    <h2 style="color:#1e3a5f;margin-top:0;">Hello ${p.name} 👋</h2>
    <p>You started an order but haven't completed it yet. Your items are still available!</p>
    <div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;font-weight:600;">Order #${shortId}</p>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr><th style="padding:8px;text-align:left;border-bottom:2px solid #e5e7eb;">Item</th><th style="padding:8px;text-align:center;border-bottom:2px solid #e5e7eb;">Qty</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p style="margin:12px 0 0;font-weight:700;font-size:18px;">Total: $${p.totalUsd.toFixed(2)} USD</p>
    </div>
    <div style="text-align:center;margin:24px 0;">
      <a href="${p.frontendUrl}/orders" style="display:inline-block;padding:14px 32px;background:#2563eb;color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">Complete My Order</a>
    </div>
    ${contactBlock ? `<p style="color:#6b7280;font-size:13px;">Need help? ${contactBlock}</p>` : ""}
  </div>
  <div style="background:#1e3a5f;padding:20px;text-align:center;color:white;font-size:12px;">
    <p style="margin:0;">AfriShop USA – Shop from USA, Deliver to Africa</p>
    <p style="margin:4px 0 0;color:#94a3b8;">© ${new Date().getFullYear()} AfriShop. All rights reserved.</p>
  </div>
</div></body></html>`;
  return { subject, html };
}

function buildReminder2(p: {
  name: string; orderId: string; totalUsd: number;
  items: { title: string; quantity: number }[];
  frontendUrl: string; whatsapp?: string; supportEmail?: string;
}) {
  const shortId = p.orderId.slice(0, 8).toUpperCase();
  const itemsHtml = p.items.map(i =>
    `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${i.title}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">x${i.quantity}</td></tr>`
  ).join("");

  const contactBlock = [
    p.whatsapp ? `<a href="https://wa.me/${p.whatsapp}" style="color:#dc2626;">WhatsApp</a>` : null,
    p.supportEmail ? `<a href="mailto:${p.supportEmail}" style="color:#dc2626;">${p.supportEmail}</a>` : null,
  ].filter(Boolean).join(" · ");

  const subject = `⚠️ Dernière chance – Votre commande expire bientôt / Last chance – Order expiring – ${shortId}`;
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#374151;">
<div style="max-width:600px;margin:0 auto;background:white;">
  <div style="background:linear-gradient(135deg,#dc2626 0%,#ef4444 100%);padding:30px;text-align:center;">
    <h1 style="color:white;margin:0;font-size:24px;">⚠️ AfriShop USA</h1>
  </div>
  <div style="padding:30px;">
    <p style="color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🇫🇷 Français</p>
    <h2 style="color:#dc2626;margin-top:0;">Dernière chance, ${p.name} ⏰</h2>
    <p><strong>Votre commande sera automatiquement annulée dans environ 10 heures</strong> si le paiement n'est pas finalisé.</p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;font-weight:600;color:#dc2626;">Commande #${shortId}</p>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr><th style="padding:8px;text-align:left;border-bottom:2px solid #fecaca;">Article</th><th style="padding:8px;text-align:center;border-bottom:2px solid #fecaca;">Qté</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p style="margin:12px 0 0;font-weight:700;font-size:18px;color:#dc2626;">Total: $${p.totalUsd.toFixed(2)} USD</p>
    </div>
    <div style="text-align:center;margin:24px 0;">
      <a href="${p.frontendUrl}/orders" style="display:inline-block;padding:14px 32px;background:#dc2626;color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">Finaliser maintenant</a>
    </div>
    ${contactBlock ? `<p style="color:#6b7280;font-size:13px;">Besoin d'aide ? ${contactBlock}</p>` : ""}

    <hr style="margin:25px 0;border:none;border-top:1px solid #e5e7eb;" />

    <p style="color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">🇬🇧 English</p>
    <h2 style="color:#dc2626;margin-top:0;">Last chance, ${p.name} ⏰</h2>
    <p><strong>Your order will be automatically cancelled in about 10 hours</strong> if payment is not completed.</p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;font-weight:600;color:#dc2626;">Order #${shortId}</p>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr><th style="padding:8px;text-align:left;border-bottom:2px solid #fecaca;">Item</th><th style="padding:8px;text-align:center;border-bottom:2px solid #fecaca;">Qty</th></tr></thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <p style="margin:12px 0 0;font-weight:700;font-size:18px;color:#dc2626;">Total: $${p.totalUsd.toFixed(2)} USD</p>
    </div>
    <div style="text-align:center;margin:24px 0;">
      <a href="${p.frontendUrl}/orders" style="display:inline-block;padding:14px 32px;background:#dc2626;color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px;">Complete Now</a>
    </div>
    ${contactBlock ? `<p style="color:#6b7280;font-size:13px;">Need help? ${contactBlock}</p>` : ""}
  </div>
  <div style="background:#7f1d1d;padding:20px;text-align:center;color:white;font-size:12px;">
    <p style="margin:0;">AfriShop USA – Shop from USA, Deliver to Africa</p>
    <p style="margin:4px 0 0;color:#fca5a5;">© ${new Date().getFullYear()} AfriShop. All rights reserved.</p>
  </div>
</div></body></html>`;
  return { subject, html };
}

// ── Main handler ─────────────────────────────────────────────────

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: cron secret or service_role
  const cronKey = req.headers.get("x-cron-secret");
  const authHeader = req.headers.get("authorization");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  let authorized = cronKey === CRON_SECRET;
  if (!authorized && authHeader) {
    authorized = authHeader === `Bearer ${serviceKey}`;
  }
  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Get settings
    const [frontendRes, whatsappRes, emailRes] = await Promise.all([
      supabase.from("admin_settings").select("value").eq("key", "frontend_base_url").single(),
      supabase.from("admin_settings").select("value").eq("key", "support_whatsapp").single(),
      supabase.from("admin_settings").select("value").eq("key", "support_email").single(),
    ]);
    const frontendUrl = frontendRes.data?.value || "https://afrishop-usa.com";
    const whatsapp = whatsappRes.data?.value || undefined;
    const supportEmail = emailRes.data?.value || undefined;

    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 3600_000).toISOString();
    const fourteenHoursAgo = new Date(now.getTime() - 14 * 3600_000).toISOString();
    const seventyTwoHoursAgo = new Date(now.getTime() - 72 * 3600_000).toISOString();

    const stats = { reminder1_sent: 0, reminder2_sent: 0, cancelled: 0, errors: [] as string[] };
    let emailsSent = 0;

    // Helper: check no paid payment attempts
    async function filterNoPaidAttempts(orders: any[]) {
      if (!orders.length) return orders;
      const ids = orders.map((o: any) => o.id);
      const { data: paid } = await supabase
        .from("payment_attempts")
        .select("order_id")
        .in("order_id", ids)
        .in("status", ["paid", "processing"]);
      const paidIds = new Set((paid || []).map((p: any) => p.order_id));
      return orders.filter((o: any) => !paidIds.has(o.id));
    }

    // Helper: send + throttle
    async function sendThrottled(to: string, subject: string, html: string, orderId: string, label: string) {
      if (emailsSent >= MAX_EMAILS_PER_RUN) return false;
      const result = await sendEmail({ to, subject, html, category: "cart_recovery" });
      emailsSent++;
      if (!result.success) {
        stats.errors.push(`${label} ${orderId}: ${result.error}`);
        return false;
      }
      if (emailsSent < MAX_EMAILS_PER_RUN) {
        await new Promise(r => setTimeout(r, THROTTLE_MS));
      }
      return true;
    }

    const orderSelect = `id, total_usd, user_id, created_at, status,
                 profiles(email, name, full_name),
                 order_items(title, quantity)`;

    // ── ACTION A: Reminder 1 (2+ hours old, no reminder 1 sent) ──
    const { data: r1Orders } = await supabase
      .from("orders")
      .select(orderSelect)
      .in("status", ["PENDING_PAYMENT", "DRAFT"])
      .lt("created_at", twoHoursAgo)
      .is("cart_reminder_sent_at", null)
      .limit(MAX_EMAILS_PER_RUN);

    const eligible1 = await filterNoPaidAttempts(
      (r1Orders || []).filter((o: any) => (o.order_items || []).length > 0)
    );

    for (const order of eligible1) {
      if (emailsSent >= MAX_EMAILS_PER_RUN) break;
      const profile = order.profiles as any;
      if (!profile?.email) continue;
      const name = profile.name || profile.full_name || "Customer";
      const items = (order.order_items || []).map((i: any) => ({ title: i.title || "Product", quantity: i.quantity || 1 }));
      const tmpl = buildReminder1({ name, orderId: order.id, totalUsd: Number(order.total_usd || 0), items, frontendUrl, whatsapp, supportEmail });
      const ok = await sendThrottled(profile.email, tmpl.subject, tmpl.html, order.id, "R1");
      if (ok) {
        await supabase.from("orders").update({ cart_reminder_sent_at: now.toISOString() }).eq("id", order.id);
        stats.reminder1_sent++;
      }
    }

    // ── ACTION B: Reminder 2 (14+ hours old, R1 sent, R2 not sent) ──
    const { data: r2Orders } = await supabase
      .from("orders")
      .select(orderSelect)
      .in("status", ["PENDING_PAYMENT", "DRAFT"])
      .lt("created_at", fourteenHoursAgo)
      .neq("cart_reminder_sent_at", null)
      .is("cart_reminder_2_sent_at", null)
      .limit(MAX_EMAILS_PER_RUN);
    const eligible2 = await filterNoPaidAttempts(
      (r2Orders || []).filter((o: any) => (o.order_items || []).length > 0)
    );

    for (const order of eligible2) {
      if (emailsSent >= MAX_EMAILS_PER_RUN) break;
      const profile = order.profiles as any;
      if (!profile?.email) continue;
      const name = profile.name || profile.full_name || "Customer";
      const items = (order.order_items || []).map((i: any) => ({ title: i.title || "Product", quantity: i.quantity || 1 }));
      const tmpl = buildReminder2({ name, orderId: order.id, totalUsd: Number(order.total_usd || 0), items, frontendUrl, whatsapp, supportEmail });
      const ok = await sendThrottled(profile.email, tmpl.subject, tmpl.html, order.id, "R2");
      if (ok) {
        await supabase.from("orders").update({ cart_reminder_2_sent_at: now.toISOString() }).eq("id", order.id);
        stats.reminder2_sent++;
      }
    }

    // ── ACTION C: Auto-cancel DISABLED (2026-06-06) ──
    // Do NOT auto-cancel PENDING_PAYMENT orders. Paid/verified orders were being
    // incorrectly cancelled due to race conditions. Admins cancel manually.
    void seventyTwoHoursAgo;

    console.log(`[order-recovery] R1:${stats.reminder1_sent} R2:${stats.reminder2_sent} Cancelled:${stats.cancelled} Errors:${stats.errors.length}`);

    return new Response(JSON.stringify({ success: true, ...stats }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("[order-recovery] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
};

serve(handler);
