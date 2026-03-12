/**
 * send-hot-products-email — Sends hot products campaign to all users
 * Requires admin JWT. Reads campaign from hot_product_campaigns,
 * fetches all users via GoTrue admin API, sends bilingual emails.
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
  id: string;
  title: string;
  image_url: string;
  price_usd: number;
  total_price_usd: number;
  product_url: string;
  provider: string;
  provider_product_id: string;
}

function buildEmailHtml(products: CampaignProduct[]): string {
  const productCards = products.map(p => `
    <div style="text-align:center;margin-bottom:20px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;max-width:280px;display:inline-block;vertical-align:top;margin:8px;">
      ${p.image_url ? `<img src="${p.image_url}" alt="${p.title}" style="width:100%;height:200px;object-fit:cover;" />` : '<div style="width:100%;height:200px;background:#f3f4f6;"></div>'}
      <div style="padding:12px;">
        <p style="font-weight:600;font-size:14px;margin:0 0 4px 0;color:#1a1a1a;">${p.title}</p>
        <p style="font-size:20px;font-weight:700;color:#e63946;margin:4px 0;">$${p.total_price_usd.toFixed(2)}</p>
        <p style="font-size:11px;color:#888;margin:0 0 8px 0;">Livraison incluse / Shipping included</p>
        <a href="${p.product_url}" style="display:inline-block;background:#e63946;color:#fff;padding:8px 24px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">Acheter / Buy Now</a>
      </div>
    </div>
  `).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="margin:0;padding:0;background:#f3f4f6;">
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;">
      <div style="text-align:center;padding:20px;background:#1a1a1a;">
        <h1 style="color:#fff;font-size:22px;margin:0;">🛍️ AfriShop USA</h1>
      </div>
      <div style="padding:24px;">
        <h2 style="text-align:center;color:#1a1a1a;font-size:18px;">🇫🇷 Produits Vedettes de la Semaine</h2>
        <p style="text-align:center;color:#555;font-size:13px;">Découvrez nos meilleurs produits sélectionnés pour vous, livrés jusqu'en RDC !</p>
        <div style="text-align:center;">${productCards}</div>
        
        <div style="margin-top:24px;padding:16px;background:#f8f9fa;border-radius:8px;border-left:4px solid #e63946;">
          <p style="font-weight:600;font-size:14px;margin:0 0 4px 0;">🔗 Vous ne trouvez pas ce que vous cherchez ?</p>
          <p style="font-size:12px;color:#555;margin:0 0 8px 0;">Allez sur notre page "Paste Any Link", choisissez un magasin et collez le lien du produit pour obtenir le prix total avec livraison.</p>
          <a href="https://afrishop-usa.com/paste-link" style="display:inline-block;background:#1a1a1a;color:#fff;padding:6px 16px;border-radius:6px;text-decoration:none;font-size:12px;font-weight:600;">Coller un lien →</a>
        </div>

        <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb;" />

        <h2 style="text-align:center;color:#1a1a1a;font-size:18px;">🇬🇧 Hot Products This Week</h2>
        <p style="text-align:center;color:#555;font-size:13px;">Check out our top picks, delivered to DRC!</p>
        <div style="text-align:center;">${productCards}</div>

        <div style="margin-top:24px;padding:16px;background:#f8f9fa;border-radius:8px;border-left:4px solid #e63946;">
          <p style="font-weight:600;font-size:14px;margin:0 0 4px 0;">🔗 Can't find what you're looking for?</p>
          <p style="font-size:12px;color:#555;margin:0 0 8px 0;">Go to our "Paste Any Link" page, choose any store from the list, and paste the product link to get the full price including shipping.</p>
          <a href="https://afrishop-usa.com/paste-link" style="display:inline-block;background:#1a1a1a;color:#fff;padding:6px 16px;border-radius:6px;text-decoration:none;font-size:12px;font-weight:600;">Paste a Link →</a>
        </div>
      </div>
      <div style="text-align:center;padding:16px;background:#f3f4f6;font-size:11px;color:#888;">
        <p style="margin:4px 0;">AfriShop USA — Shop from anywhere, delivered to Africa</p>
        <p style="margin:4px 0;">© ${new Date().getFullYear()} AfriShop USA. All rights reserved.</p>
      </div>
    </div>
  </body></html>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
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
    if (authErr || !user) {
      return jsonRes({ ok: false, error: 'Unauthorized' }, 401);
    }

    // Verify admin
    const { data: adminRow } = await supabase
      .from('admin_users')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();
    if (!adminRow) {
      return jsonRes({ ok: false, error: 'Admin access required' }, 403);
    }

    const { campaignId } = await req.json();
    if (!campaignId) {
      return jsonRes({ ok: false, error: 'campaignId required' }, 400);
    }

    // Load campaign
    const { data: campaign, error: campErr } = await supabase
      .from('hot_product_campaigns')
      .select('*')
      .eq('id', campaignId)
      .maybeSingle();
    if (campErr || !campaign) {
      return jsonRes({ ok: false, error: 'Campaign not found' }, 404);
    }

    const products = (campaign.products as CampaignProduct[]) || [];
    if (products.length === 0) {
      return jsonRes({ ok: false, error: 'No products in campaign' }, 400);
    }

    // Update status to sending
    await supabase
      .from('hot_product_campaigns')
      .update({ status: 'sending' })
      .eq('id', campaignId);

    // Build email
    const html = buildEmailHtml(products);
    const productNames = products.map(p => p.title).join(', ');
    const subject = `🛍️ Produits Vedettes / Hot Products: ${productNames}`;

    // Fetch all users via GoTrue admin API
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

    let allUsers: { email: string }[] = [];
    let page = 1;
    const perPage = 1000;

    while (true) {
      const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
        headers: {
          'Authorization': `Bearer ${serviceRoleKey}`,
          'apikey': serviceRoleKey!,
        },
      });
      const data = await res.json();
      const users = data.users || [];
      if (users.length === 0) break;
      allUsers.push(...users.filter((u: any) => u.email).map((u: any) => ({ email: u.email })));
      if (users.length < perPage) break;
      page++;
    }

    console.log(`[HotProducts] Sending to ${allUsers.length} users`);

    let sent = 0;
    let failed = 0;

    for (const u of allUsers) {
      const result = await sendEmail({
        to: u.email,
        subject,
        html,
        category: 'admin_notification',
      });
      if (result.success) {
        sent++;
      } else {
        failed++;
        console.error(`[HotProducts] Failed for ${u.email}: ${result.error}`);
      }
      // 600ms delay for rate limiting
      await new Promise(r => setTimeout(r, 600));
    }

    // Update campaign
    await supabase
      .from('hot_product_campaigns')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        sent_count: sent,
        failed_count: failed,
      })
      .eq('id', campaignId);

    console.log(`[HotProducts] Campaign ${campaignId} done: ${sent} sent, ${failed} failed`);
    return jsonRes({ ok: true, sent, failed });
  } catch (err) {
    console.error('[HotProducts] Error:', err);
    return jsonRes({ ok: false, error: String(err) }, 500);
  }
});
