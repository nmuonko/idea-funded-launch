// Bulk-publishes pending Telegram image drafts as international products,
// generating an English title + short description from the photo with Lovable AI.
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-3.6-flash';

type Draft = {
  id: string;
  image_url: string;
  caption: string | null;
  suggested_title: string | null;
  suggested_price_usd: number | string | null;
  detected_category: string | null;
  forwarded_from_chat_username: string | null;
};

const SYSTEM = `You are a product cataloguer for an online store selling Turkish/international fashion in DR Congo.
Look at the photo and return STRICT JSON only:
{"title":"<max 70 chars, English, e.g. 'Men Slim Fit Wool Blazer - Navy'>","description":"<1-2 short English sentences about material, style and fit. No prices, no emojis, no phone numbers, no shop names.>","sizes":["<likely size labels, e.g. 46,48,50 for suits or S,M,L,XL for casual>"],"weight_kg":<estimated shipping weight number>,"price":<number or null>,"currency":"<USD|TRY|EUR or null>"}
Price rules: if a price is printed/written on the photo or given in the seller notes, return that exact number in "price" and its currency in "currency" (Turkish Lira = TRY, symbols ₺ or TL; $ = USD; € = EUR). If no price is visible anywhere, return "price": null. Never guess or invent a price.
Other rules: title and description in English only. The description must never mention a price or currency. Never invent brand names. If the item is unclear, describe it generically.`;

// Parse a price out of a Telegram caption, e.g. "45$", "$45", "1200 TL", "₺1.250", "40 usd"
function parseCaptionPrice(caption: string | null): { price: number; currency: string } | null {
  if (!caption) return null;
  const text = caption.replace(/\s+/g, ' ');
  const patterns: Array<{ re: RegExp; currency: string }> = [
    { re: /(?:\$|usd\s*)\s*([0-9]+(?:[.,][0-9]{1,2})?)/i, currency: 'USD' },
    { re: /([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:\$|usd|dollars?)/i, currency: 'USD' },
    { re: /(?:₺|tl\s*|try\s*)\s*([0-9]+(?:[.,][0-9]{1,3})?)/i, currency: 'TRY' },
    { re: /([0-9]+(?:[.,][0-9]{1,3})?)\s*(?:₺|tl\b|try\b|lira)/i, currency: 'TRY' },
    { re: /(?:€|eur\s*)\s*([0-9]+(?:[.,][0-9]{1,2})?)/i, currency: 'EUR' },
    { re: /([0-9]+(?:[.,][0-9]{1,2})?)\s*(?:€|eur\b|euros?)/i, currency: 'EUR' },
  ];
  for (const { re, currency } of patterns) {
    const m = text.match(re);
    if (m) {
      const n = Number(m[1].replace(',', '.'));
      if (Number.isFinite(n) && n > 0) return { price: n, currency };
    }
  }
  return null;
}

// Normalize any detected price to USD.
function toUsd(price: number, currency: string | null, tryRate: number, eurRate: number): number | null {
  if (!Number.isFinite(price) || price <= 0) return null;
  const c = (currency ?? 'USD').toUpperCase();
  const usd = c === 'TRY' ? price / tryRate : c === 'EUR' ? price * eurRate : price;
  if (!Number.isFinite(usd) || usd <= 0 || usd > 100000) return null;
  return Math.round(usd * 100) / 100;
}

async function describe(apiKey: string, d: Draft): Promise<{
  title: string;
  description: string;
  sizes: string[];
  weight_kg: number | null;
  price: number | null;
  currency: string | null;
} | null> {
  const hint = [d.suggested_title, d.caption, d.detected_category].filter(Boolean).join(' | ').slice(0, 400);
  try {
    const res = await fetch(AI_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM },
          {
            role: 'user',
            content: [
              { type: 'text', text: hint ? `Seller notes (may be Turkish/French): ${hint}` : 'Catalogue this product photo. Read any price printed on the image.' },
              { type: 'image_url', image_url: { url: d.image_url } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error(`AI failed [${res.status}]: ${await res.text()}`);
      return null;
    }
    const data = await res.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const title = String(parsed.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) return null;
    return {
      title,
      description: String(parsed.description ?? '').trim().slice(0, 600),
      sizes: Array.isArray(parsed.sizes) ? parsed.sizes.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 20) : [],
      weight_kg: Number.isFinite(Number(parsed.weight_kg)) ? Number(parsed.weight_kg) : null,
      price: Number.isFinite(Number(parsed.price)) && Number(parsed.price) > 0 ? Number(parsed.price) : null,
      currency: typeof parsed.currency === 'string' ? parsed.currency : null,
    };
  } catch (e) {
    console.error('AI describe error', e);
    return null;
  }
}


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return json({ error: 'Server not configured' }, 500);
    if (!LOVABLE_API_KEY) return json({ error: 'AI is not configured' }, 500);

    // ---- Auth: admin only ----
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser();
    const user = userRes?.user;
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: isAdmin } = await admin.rpc('has_role', { _user_id: user.id, _role: 'admin' });
    if (!isAdmin) return json({ error: 'Forbidden' }, 403);

    // ---- Input ----
    const body = await req.json().catch(() => ({}));
    const draftIds: string[] = Array.isArray(body?.draftIds)
      ? body.draftIds.filter((x: unknown) => typeof x === 'string').slice(0, 12)
      : [];
    const price = Number(body?.price);
    const hasFallbackPrice = Number.isFinite(price) && price > 0;
    const country = typeof body?.country === 'string' && body.country.trim() ? body.country.trim() : 'turkey';
    const fallbackWeight = Number.isFinite(Number(body?.weightKg)) && Number(body.weightKg) > 0 ? Number(body.weightKg) : 0.7;
    // FX used only to normalize a supplier price detected in TRY/EUR into USD.
    const tryRate = Number.isFinite(Number(body?.tryPerUsd)) && Number(body.tryPerUsd) > 1 ? Number(body.tryPerUsd) : 41;
    const eurRate = Number.isFinite(Number(body?.usdPerEur)) && Number(body.usdPerEur) > 0 ? Number(body.usdPerEur) : 1.08;
    if (draftIds.length === 0) return json({ error: 'draftIds required (max 12 per call)' }, 400);

    const { data: drafts, error: dErr } = await admin
      .from('telegram_import_drafts')
      .select('id, image_url, caption, suggested_title, suggested_price_usd, detected_category, forwarded_from_chat_username')
      .in('id', draftIds)
      .eq('status', 'pending');
    if (dErr) return json({ error: dErr.message }, 500);

    const results: Array<{ id: string; ok: boolean; title?: string; price?: number; priceSource?: string; error?: string }> = [];

    for (const d of (drafts ?? []) as Draft[]) {
      const ai = await describe(LOVABLE_API_KEY, d);
      const title = ai?.title ?? d.suggested_title ?? 'Fashion item';
      const weight = ai?.weight_kg && ai.weight_kg > 0 ? Math.min(ai.weight_kg, 15) : fallbackWeight;
      const sourceUrl = d.forwarded_from_chat_username ? `https://t.me/${d.forwarded_from_chat_username}` : 'https://t.me/';

      // ---- Price: draft value > caption text > price read from the photo > fallback ----
      const draftPrice = Number(d.suggested_price_usd);
      const captionPrice = parseCaptionPrice(d.caption);
      let finalPrice: number | null = null;
      let priceSource = 'none';
      if (Number.isFinite(draftPrice) && draftPrice > 0) {
        finalPrice = Math.round(draftPrice * 100) / 100;
        priceSource = 'draft';
      } else if (captionPrice) {
        finalPrice = toUsd(captionPrice.price, captionPrice.currency, tryRate, eurRate);
        priceSource = `caption_${captionPrice.currency}`;
      }
      if (!finalPrice && ai?.price) {
        finalPrice = toUsd(ai.price, ai.currency, tryRate, eurRate);
        if (finalPrice) priceSource = `image_${(ai.currency ?? 'USD').toUpperCase()}`;
      }
      if (!finalPrice && hasFallbackPrice) {
        finalPrice = price;
        priceSource = 'fallback';
      }
      if (!finalPrice) {
        results.push({ id: d.id, ok: false, error: 'No price found on the photo or caption — set a fallback price' });
        continue;
      }

      const { data: prod, error: pErr } = await admin
        .from('international_products')
        .insert({
          country,
          title,
          image_url: d.image_url,
          images: [d.image_url],
          product_url: sourceUrl,
          base_price_usd: finalPrice,
          est_weight_kg: weight,
          description: ai?.description || null,
          available_sizes: ai?.sizes ?? [],
          is_active: true,
        })
        .select('id')
        .single();

      if (pErr || !prod) {
        results.push({ id: d.id, ok: false, error: pErr?.message ?? 'insert failed' });
        continue;
      }

      await admin
        .from('telegram_import_drafts')
        .update({
          status: 'published',
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
          published_product_id: prod.id,
          suggested_country: country,
          suggested_title: title,
          suggested_price_usd: finalPrice,
          suggested_weight_kg: weight,
        })
        .eq('id', d.id);

      results.push({ id: d.id, ok: true, title, price: finalPrice, priceSource });
    }


    return json({
      published: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (e) {
    console.error('telegram-drafts-ai-publish error', e);
    return json({ error: e instanceof Error ? e.message : 'Unexpected error' }, 500);
  }
});
