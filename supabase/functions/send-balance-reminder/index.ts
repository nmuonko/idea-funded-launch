/**
 * send-balance-reminder
 *
 * Sends the customer an email reminding them to pay the remaining 70% balance
 * on a deposit-plan order. Idempotent: only sends if order.balance_status='pending'.
 *
 * Trigger paths:
 *   - Automatic: admin-service / admin OrderDetail when SHIPPED transition happens.
 *   - Manual:   admin OrderDetail "Send balance reminder" button.
 */

import { createClient } from "@supabase/supabase-js";
import { getCorsHeaders } from "../_shared/http.ts";
import {
  extractRequestToken,
  verifyAndGetUser,
  authErrorResponse,
} from "../_shared/auth.ts";

const corsHeaders = getCorsHeaders();
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const requestId = crypto.randomUUID();
  try {
    const { token, source } = await extractRequestToken(req);
    if (!token) return authErrorResponse("NO_TOKEN", "Please sign in.", { requestId });

    let user: any;
    try {
      const r = await verifyAndGetUser(req, undefined, { token, source });
      user = r.user;
    } catch {
      return authErrorResponse("INVALID_TOKEN", undefined, { requestId });
    }

    const body = await req.json().catch(() => ({} as any));
    const orderId = body?.order_id || body?.orderId;
    if (!orderId) return json({ success: false, error: "order_id required", error_code: "BAD_REQUEST" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify caller is either order owner or admin
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, user_id, status, payment_plan, balance_status, balance_amount_usd, deposit_amount_usd, total_usd, balance_reminder_sent_at, profiles(name, email)")
      .eq("id", orderId)
      .single();

    if (orderErr || !order) return json({ success: false, error: "Order not found", error_code: "ORDER_NOT_FOUND" });

    // Permission: owner OR admin (use existing has_role check via user_roles)
    let isAdmin = false;
    if (order.user_id !== user.id) {
      const { data: roleRow } = await supabase
        .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
      isAdmin = !!roleRow;
      if (!isAdmin) return json({ success: false, error: "Not authorized", error_code: "NOT_AUTHORIZED" });
    }

    if (order.payment_plan !== "deposit") {
      return json({ success: false, error: "Order is not on a deposit plan", error_code: "NOT_DEPOSIT_ORDER" });
    }
    if (order.balance_status !== "pending") {
      return json({ success: false, error: "Balance is not pending", error_code: "BALANCE_NOT_PENDING" });
    }

    const profile: any = (order as any).profiles;
    if (!profile?.email) {
      return json({ success: false, error: "Customer has no email on file", error_code: "NO_EMAIL" });
    }

    // Build payment link — sends customer to their order page where Pay Balance button lives
    const appUrl = Deno.env.get("PUBLIC_APP_URL") || "https://afrishop-usa.com";
    const payLink = `${appUrl}/orders/${order.id}?pay_balance=1`;
    const balanceUsd = Number(order.balance_amount_usd || 0).toFixed(2);
    const depositUsd = Number(order.deposit_amount_usd || 0).toFixed(2);
    const totalUsd = Number(order.total_usd || 0).toFixed(2);
    const customerName = profile.name || "Customer";

    // Use the project's existing email-service for delivery
    const { error: emailErr } = await supabase.functions.invoke("email-service", {
      body: {
        type: "balance_reminder",
        orderId: order.id,
        customerEmail: profile.email,
        customerName,
        subject: `Action required: pay your 70% balance ($${balanceUsd}) for order #${order.id.slice(0, 8).toUpperCase()}`,
        // generic fields so email-service templates can render too
        html: buildHtml({ customerName, balanceUsd, depositUsd, totalUsd, payLink, orderShort: order.id.slice(0, 8).toUpperCase() }),
        text: buildText({ customerName, balanceUsd, payLink, orderShort: order.id.slice(0, 8).toUpperCase() }),
      },
    });

    if (emailErr) {
      console.error("[send-balance-reminder] email-service error:", emailErr);
      return json({ success: false, error: emailErr.message || "Failed to send email", error_code: "EMAIL_FAILED" });
    }

    // Mark reminder sent
    await supabase.from("orders").update({
      balance_reminder_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", orderId);

    return json({ success: true, message: "Balance reminder sent." });
  } catch (e: any) {
    console.error("[send-balance-reminder] fatal", e);
    return json({ success: false, error: e?.message || "Internal error" });
  }
});

function buildHtml(p: { customerName: string; balanceUsd: string; depositUsd: string; totalUsd: string; payLink: string; orderShort: string }): string {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#f6f7f9;padding:24px;color:#111">
    <table style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
      <tr><td style="padding:24px">
        <h2 style="margin:0 0 8px;color:#0f172a">Your order has arrived — please pay the balance</h2>
        <p style="margin:0 0 16px;color:#475569">Hi ${escapeHtml(p.customerName)}, your AfriShop order <strong>#${escapeHtml(p.orderShort)}</strong> is here. To complete delivery, please pay the remaining 70% balance.</p>
        <table style="width:100%;border-collapse:collapse;margin:12px 0 20px">
          <tr><td style="padding:6px 0;color:#475569">Order total</td><td style="padding:6px 0;text-align:right">$${escapeHtml(p.totalUsd)}</td></tr>
          <tr><td style="padding:6px 0;color:#475569">Deposit paid (30%)</td><td style="padding:6px 0;text-align:right;color:#16a34a">−$${escapeHtml(p.depositUsd)}</td></tr>
          <tr><td style="padding:10px 0;font-weight:700;border-top:1px solid #e5e7eb">Balance due now (70%)</td><td style="padding:10px 0;text-align:right;font-weight:700;border-top:1px solid #e5e7eb">$${escapeHtml(p.balanceUsd)}</td></tr>
        </table>
        <p style="margin:0 0 16px;text-align:center"><a href="${escapeHtml(p.payLink)}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:999px;text-decoration:none;font-weight:600">Pay balance now</a></p>
        <p style="margin:16px 0 0;font-size:12px;color:#94a3b8">If the button doesn't work, copy this link: ${escapeHtml(p.payLink)}</p>
      </td></tr>
    </table>
  </body></html>`;
}

function buildText(p: { customerName: string; balanceUsd: string; payLink: string; orderShort: string }): string {
  return `Hi ${p.customerName},\n\nYour AfriShop order #${p.orderShort} has arrived. Please pay the remaining 70% balance of $${p.balanceUsd}:\n\n${p.payLink}\n\nThank you,\nAfriShop`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
