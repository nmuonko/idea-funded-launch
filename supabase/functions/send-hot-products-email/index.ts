/**
 * send-hot-products-email — Sends hot products campaign to all users
 * Short, convincing bilingual email with 2-4 week delivery timeline
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "../_shared/email.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

interface CampaignProduct {
  title: string;
  image_url: string;
  total_price_usd: number;
  product_url: string;
}

function buildEmailHtml(products: CampaignProduct[]): string {
  const productCards = products.map(p => `
    <tr><td align="center" style="padding:8px;">
      <table width="260" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#ffffff;">
        ${p.image_url ? `<tr><td><img src="${p.image_url}" alt="${p.title}" width="260" height="220" style="display:block;width:260px;height:220px;object-fit:cover;" /></td></tr>` : ''}
        <tr><td style="padding:12px;text-align:center;">
          <p style="font-weight:600;font-size:13px;margin:0 0 4px;color:#1a1a1a;line-height:1.3;">${p.title.length > 50 ? p.title.slice(0, 50) + '…' : p.title}</p>
          <p style="font-size:22px;font-weight:800;color:#e63946;margin:6px 0 2px;">$${p.total_price_usd.toFixed(2)}</p>
          <p style="font-size:10px;color:#666;margin:0 0 10px;">Tout inclus / All-inclusive</p>
          <a href="${p.product_url}" style="display:inline-block;background:#e63946;color:#ffffff;padding:10px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">Commander / Order</a>
        </td></tr>
      </table>
    </td></tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>AfriShop USA - Produits Vedettes</title></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;-webkit-font-smoothing:antialiased;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f4f6"><tr><td align="center" style="padding:20px 0;">
  <table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:600px;border-radius:8px;overflow:hidden;">
    <!-- Header -->
    <tr><td style="text-align:center;padding:20px;background-color:#1a1a1a;">
      <h1 style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:20px;margin:0;">AfriShop USA</h1>
    </td></tr>
    <!-- Intro -->
    <tr><td style="padding:20px 24px 8px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      <p style="font-size:16px;font-weight:700;color:#1a1a1a;margin:0 0 6px;">Produits Vedettes / Hot Picks</p>
      <p style="font-size:12px;color:#555;margin:0;">Prix tout inclus. Livraison en RDC en 2-4 semaines.</p>
      <p style="font-size:12px;color:#555;margin:2px 0 0;">All-inclusive price. Delivered to DRC in 2-4 weeks.</p>
    </td></tr>
    <!-- Products -->
    <tr><td style="padding:8px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        ${productCards}
      </table>
    </td></tr>
    <!-- Paste Link CTA -->
    <tr><td style="padding:12px 24px 20px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#fff8f0;border-radius:8px;border:1px solid #fde1c3;">
        <tr><td style="padding:14px 16px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
          <p style="font-size:13px;color:#333;margin:0 0 4px;font-weight:600;">Envie d'autre chose? / Want something else?</p>
          <p style="font-size:11px;color:#555;margin:0 0 10px;">Collez le lien de n'importe quel produit USA.<br/>Paste any US product link and get the delivered price.</p>
          <a href="https://afrishop-usa.com/paste-link" style="display:inline-block;background-color:#1a1a1a;color:#ffffff;padding:8px 20px;border-radius:6px;text-decoration:none;font-size:12px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">Coller un lien / Paste a Link</a>
        </td></tr>
      </table>
    </td></tr>
    <!-- Footer -->
    <tr><td style="text-align:center;padding:16px 24px;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
      <p style="margin:0 0 4px;font-size:11px;color:#999;">AfriShop USA - Achetez aux USA, livr&eacute; en Afrique</p>
      <p style="margin:0 0 4px;font-size:10px;color:#bbb;">&copy; ${new Date().getFullYear()} AfriShop USA. All rights reserved.</p>
      <p style="margin:0;font-size:10px;color:#bbb;">Vous recevez cet email car vous avez un compte AfriShop USA.<br/>You are receiving this email because you have an AfriShop USA account.</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function buildPlainText(products: CampaignProduct[]): string {
  let text = "AfriShop USA - Produits Vedettes / Hot Picks\n\n";
  text += "Prix tout inclus. Livraison en RDC en 2-4 semaines.\nAll-inclusive price. Delivered to DRC in 2-4 weeks.\n\n";
  for (const p of products) {
    text += `${p.title}\n$${p.total_price_usd.toFixed(2)} (tout inclus / all-inclusive)\n${p.product_url}\n\n`;
  }
  text += "---\nEnvie d'autre chose? Collez un lien: https://afrishop-usa.com/paste-link\n";
  text += "Want something else? Paste a link: https://afrishop-usa.com/paste-link\n\n";
  text += "AfriShop USA - Achetez aux USA, livre en Afrique\n";
  return text;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { campaignId, testEmail } = body;

    // Anti-spam headers
    const emailHeaders: Record<string, string> = {
      "List-Unsubscribe": "<mailto:nkadimisha@afrishop-usa.com?subject=unsubscribe>",
      "X-Entity-Ref-ID": crypto.randomUUID(),
    };

    // === TEST MODE ===
    if (testEmail && !campaignId) {
      const sampleProducts: CampaignProduct[] = [
        { title: 'iPhone 16 Pro Max 256GB', image_url: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-16-pro-finish-select-202409-6-3inch-deserttitanium?wid=600&hei=600&fmt=jpeg', total_price_usd: 1650.00, product_url: 'https://afrishop-usa.com/paste-link' },
        { title: 'PlayStation 5 Slim Console', image_url: 'https://m.media-amazon.com/images/I/51pMtfGmjcL._SL1500_.jpg', total_price_usd: 720.00, product_url: 'https://afrishop-usa.com/paste-link' },
        { title: 'Nike Air Max 90 Premium', image_url: 'https://m.media-amazon.com/images/I/71KMCJBfLdL._AC_SL1500_.jpg', total_price_usd: 225.00, product_url: 'https://afrishop-usa.com/paste-link' },
      ];
      const html = buildEmailHtml(sampleProducts);
      const text = buildPlainText(sampleProducts);
      const subject = 'Produits Vedettes cette semaine - AfriShop USA';
      const result = await sendEmail({
        to: testEmail,
        subject,
        html,
        text,
        from: 'AfriShop USA <nkadimisha@afrishop-usa.com>',
        category: 'customer_email',
        replyTo: 'nkadimisha@afrishop-usa.com',
        headers: emailHeaders,
      });
      console.log(`[HotProducts] Test email to ${testEmail}: ${result.success ? 'sent' : 'failed'}`, result.id || result.error);
      return jsonRes({ ok: result.success, test: true, to: testEmail, emailId: result.id, error: result.error });
    }

    // Auth required for campaign sends
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonRes({ ok: false, error: 'Unauthorized' }, 401);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return jsonRes({ ok: false, error: 'Unauthorized' }, 401);

    const { data: adminRow } = await supabase.from('admin_users').select('id').eq('id', user.id).maybeSingle();
    if (!adminRow) return jsonRes({ ok: false, error: 'Admin access required' }, 403);

    if (!campaignId) return jsonRes({ ok: false, error: 'campaignId required' }, 400);

    const { data: campaign } = await supabase.from('hot_product_campaigns').select('*').eq('id', campaignId).maybeSingle();
    if (!campaign) return jsonRes({ ok: false, error: 'Campaign not found' }, 404);

    const products = (campaign.products as CampaignProduct[]) || [];
    if (products.length === 0) return jsonRes({ ok: false, error: 'No products' }, 400);

    await supabase.from('hot_product_campaigns').update({ status: 'sending' }).eq('id', campaignId);

    const html = buildEmailHtml(products);
    const text = buildPlainText(products);
    const subject = `Produits Vedettes - AfriShop USA`;

    // Fetch all users
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    let allUsers: { email: string }[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=1000`, {
        headers: { 'Authorization': `Bearer ${serviceRoleKey}`, 'apikey': serviceRoleKey! },
      });
      const data = await res.json();
      const users = data.users || [];
      if (users.length === 0) break;
      allUsers.push(...users.filter((u: any) => u.email).map((u: any) => ({ email: u.email })));
      if (users.length < 1000) break;
      page++;
    }

    console.log(`[HotProducts] Sending to ${allUsers.length} users`);
    let sent = 0, failed = 0;

    for (const u of allUsers) {
      const result = await sendEmail({
        to: u.email,
        subject,
        html,
        text,
        from: 'AfriShop USA <nkadimisha@afrishop-usa.com>',
        category: 'customer_email',
        replyTo: 'nkadimisha@afrishop-usa.com',
        headers: emailHeaders,
      });
      result.success ? sent++ : failed++;
      await new Promise(r => setTimeout(r, 600));
    }

    await supabase.from('hot_product_campaigns').update({
      status: 'sent', sent_at: new Date().toISOString(), sent_count: sent, failed_count: failed,
    }).eq('id', campaignId);

    console.log(`[HotProducts] Done: ${sent} sent, ${failed} failed`);
    return jsonRes({ ok: true, sent, failed });
  } catch (err) {
    console.error('[HotProducts] Error:', err);
    return jsonRes({ ok: false, error: String(err) }, 500);
  }
});
