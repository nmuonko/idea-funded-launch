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
    <div style="text-align:center;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;max-width:260px;display:inline-block;vertical-align:top;margin:8px;">
      ${p.image_url ? `<img src="${p.image_url}" alt="${p.title}" style="width:100%;height:220px;object-fit:cover;" />` : ''}
      <div style="padding:10px;">
        <p style="font-weight:600;font-size:13px;margin:0 0 2px;color:#1a1a1a;line-height:1.3;">${p.title.length > 50 ? p.title.slice(0, 50) + '…' : p.title}</p>
        <p style="font-size:22px;font-weight:800;color:#e63946;margin:6px 0 2px;">$${p.total_price_usd.toFixed(2)}</p>
        <p style="font-size:10px;color:#666;margin:0 0 8px;">Tout inclus · All-inclusive</p>
        <a href="${p.product_url}" style="display:inline-block;background:#e63946;color:#fff;padding:10px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">🛒 Commander</a>
      </div>
    </div>
  `).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#f3f4f6;">
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
      <div style="text-align:center;padding:16px 20px;background:#1a1a1a;">
        <h1 style="color:#fff;font-size:20px;margin:0;">🛍️ AfriShop USA</h1>
      </div>
      <div style="padding:20px;">
        <p style="text-align:center;font-size:15px;font-weight:700;color:#1a1a1a;margin:0 0 4px;">🔥 Produits Vedettes / Hot Picks</p>
        <p style="text-align:center;font-size:12px;color:#555;margin:0 0 16px;">Prix tout inclus – livraison en RDC en 2-4 semaines<br/>All-inclusive price – delivered to DRC in 2-4 weeks</p>
        <div style="text-align:center;">${productCards}</div>
        <div style="margin:20px 0;padding:12px 16px;background:#fff8f0;border-radius:8px;border:1px solid #fde1c3;text-align:center;">
          <p style="font-size:12px;color:#333;margin:0 0 6px;font-weight:600;">🔗 Envie d'autre chose ? / Want something else?</p>
          <p style="font-size:11px;color:#555;margin:0 0 8px;">Collez le lien de n'importe quel produit USA et obtenez le prix total !<br/>Paste any US product link and get the full delivered price!</p>
          <a href="https://afrishop-usa.com/paste-link" style="display:inline-block;background:#1a1a1a;color:#fff;padding:6px 18px;border-radius:6px;text-decoration:none;font-size:11px;font-weight:700;">Coller un lien / Paste a Link →</a>
        </div>
      </div>
      <div style="text-align:center;padding:12px;background:#f3f4f6;font-size:10px;color:#999;">
        <p style="margin:2px 0;">AfriShop USA · Achetez aux USA, livré en Afrique</p>
        <p style="margin:2px 0;">© ${new Date().getFullYear()} AfriShop USA</p>
      </div>
    </div>
  </body></html>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { campaignId, testEmail, cronSecret } = body;

    // === TEST MODE: send sample email to a single address (no auth needed) ===
    if (testEmail && !campaignId) {
      const sampleProducts: CampaignProduct[] = [
        { title: 'iPhone 16 Pro Max 256GB', image_url: 'https://store.storeimages.cdn-apple.com/4982/as-images.apple.com/is/iphone-16-pro-finish-select-202409-6-3inch-deserttitanium?wid=600&hei=600&fmt=jpeg', total_price_usd: 1650.00, product_url: 'https://afrishop-usa.com/paste-link' },
        { title: 'PlayStation 5 Slim Console', image_url: 'https://m.media-amazon.com/images/I/51pMtfGmjcL._SL1500_.jpg', total_price_usd: 720.00, product_url: 'https://afrishop-usa.com/paste-link' },
        { title: 'Nike Air Max 90 Premium', image_url: 'https://static.nike.com/a/images/t_PDP_1728_v1/f_auto,q_auto:eco/af407d53-37fc-4a91-bf20-094c2845e039/NIKE+AIR+MAX+90.png', total_price_usd: 225.00, product_url: 'https://afrishop-usa.com/paste-link' },
      ];
      const html = buildEmailHtml(sampleProducts);
      const subject = '🔥 Hot Picks: iPhone 16 Pro Max | PS5 Slim | Nike Air Max 90';
      const result = await sendEmail({ to: testEmail, subject, html, category: 'admin_notification' });
      console.log(`[HotProducts] Test email to ${testEmail}: ${result.success ? 'sent' : 'failed'}`);
      return jsonRes({ ok: result.success, test: true, to: testEmail });
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
    const subject = `🔥 Hot Picks: ${products.map(p => p.title.slice(0, 25)).join(' | ')}`;

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
      const result = await sendEmail({ to: u.email, subject, html, category: 'admin_notification' });
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
