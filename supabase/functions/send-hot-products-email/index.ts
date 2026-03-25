import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SITE_URL = "https://afrishop-usa.com";

function buildProductGrid(products: any[]): string {
  const cards = products
    .map(
      (p) => `
    <td style="width:33%;padding:8px;vertical-align:top;text-align:center;">
      <a href="${SITE_URL}/product/${p.provider}/${p.provider_product_id}?hot=1" style="text-decoration:none;color:inherit;">
        <img src="${p.image_url}" alt="${p.title}" style="width:100%;max-width:200px;height:auto;border-radius:8px;border:1px solid #e5e7eb;" />
        <p style="margin:8px 0 4px;font-size:14px;font-weight:600;color:#111;">${p.title?.substring(0, 60)}${(p.title?.length || 0) > 60 ? "…" : ""}</p>
        <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#16a34a;">$${Number(p.total_price_usd).toFixed(2)}</p>
        <span style="display:inline-block;background:#f97316;color:#fff;padding:8px 20px;border-radius:6px;font-weight:600;font-size:14px;">Order Now</span>
      </a>
    </td>`
    )
    .join("");

  // Wrap in rows of 3
  const rows: string[] = [];
  const items = products.length;
  for (let i = 0; i < items; i += 3) {
    const slice = products.slice(i, i + 3);
    const tds = slice
      .map(
        (p) => `
      <td style="width:33%;padding:8px;vertical-align:top;text-align:center;">
        <a href="${SITE_URL}/product/${p.provider}/${p.provider_product_id}?hot=1" style="text-decoration:none;color:inherit;">
          <img src="${p.image_url}" alt="${p.title}" style="width:100%;max-width:200px;height:auto;border-radius:8px;border:1px solid #e5e7eb;" />
          <p style="margin:8px 0 4px;font-size:14px;font-weight:600;color:#111;">${p.title?.substring(0, 60)}${(p.title?.length || 0) > 60 ? "…" : ""}</p>
          <p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#16a34a;">$${Number(p.total_price_usd).toFixed(2)}</p>
          <span style="display:inline-block;background:#f97316;color:#fff;padding:8px 20px;border-radius:6px;font-weight:600;font-size:14px;">Order Now</span>
        </a>
      </td>`
      )
      .join("");
    rows.push(`<tr>${tds}</tr>`);
  }

  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rows.join("")}</table>`;
}

function buildEmailHtml(campaignTitle: string, products: any[]): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:20px 0;">
<tr><td align="center">
  <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
    <tr><td style="background:linear-gradient(135deg,#f97316,#ea580c);padding:24px 20px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:24px;">🔥 ${campaignTitle}</h1>
      <p style="margin:8px 0 0;color:#fff;font-size:14px;opacity:0.9;">Shipped directly to DRC — prices include everything!</p>
    </td></tr>
    <tr><td style="padding:20px;">
      ${buildProductGrid(products)}
    </td></tr>
    <tr><td style="padding:16px 20px;text-align:center;background:#f9fafb;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">AfriShop USA — Shop from the US, delivered to DRC</p>
      <p style="margin:4px 0 0;font-size:12px;color:#9ca3af;"><a href="${SITE_URL}" style="color:#f97316;">Visit our store</a></p>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { campaignId } = await req.json();
    if (!campaignId) {
      return new Response(JSON.stringify({ error: "campaignId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load campaign
    const { data: campaign, error: campErr } = await admin
      .from("hot_product_campaigns")
      .select("*")
      .eq("id", campaignId)
      .single();

    if (campErr || !campaign) {
      return new Response(
        JSON.stringify({ error: "Campaign not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const products = campaign.products || [];
    if (!products.length) {
      return new Response(
        JSON.stringify({ error: "No products in campaign" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update status to sending
    await admin.from("hot_product_campaigns").update({ status: "sending" }).eq("id", campaignId);

    // Load all user emails from profiles
    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("email");

    if (profilesError) {
      throw new Error(`Failed to load recipients: ${profilesError.message}`);
    }

    const emails = (profiles || [])
      .map((p: any) => p.email?.trim())
      .filter((e: string) => !!e && e.includes("@"));

    const uniqueEmails = [...new Set(emails)] as string[];
    console.log(`[HotProducts] Sending campaign "${campaign.title}" to ${uniqueEmails.length} recipients`);

    const html = buildEmailHtml(campaign.title || "Hot Products", products);

    let sent = 0;
    let failed = 0;

    for (const email of uniqueEmails) {
      try {
        const result = await sendEmail({
          to: email,
          subject: `🔥 ${campaign.title || "Hot Products"} — AfriShop USA`,
          html,
          category: "admin_notification",
        });
        if (result.success) sent++;
        else failed++;
      } catch {
        failed++;
      }
      // Rate limit: 600ms between sends
      await new Promise((r) => setTimeout(r, 600));
    }

    // Update campaign
    await admin
      .from("hot_product_campaigns")
      .update({
        status: "sent",
        sent_count: sent,
        failed_count: failed,
        sent_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    console.log(`[HotProducts] Campaign done: ${sent} sent, ${failed} failed`);

    return new Response(
      JSON.stringify({ sent, failed, total: uniqueEmails.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[HotProducts] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
