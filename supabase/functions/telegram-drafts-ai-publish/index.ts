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
  detected_category: string | null;
  forwarded_from_chat_username: string | null;
};

const SYSTEM = `You are a product cataloguer for an online store selling Turkish/international fashion in DR Congo.
Look at the photo and return STRICT JSON only:
{"title":"<max 70 chars, English, e.g. 'Men Slim Fit Wool Blazer - Navy'>","description":"<1-2 short English sentences about material, style and fit. No prices, no emojis, no phone numbers, no shop names.>","sizes":["<likely size labels, e.g. 46,48,50 for suits or S,M,L,XL for casual>"],"weight_kg":<estimated shipping weight number>}
Rules: English only. Never mention any price or currency. Never invent brand names. If the item is unclear, describe it generically.`;

async function describe(apiKey: string, d: Draft): Promise<{
  title: string;
  description: string;
  sizes: string[];
  weight_kg: number | null;
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
              { type: 'text', text: hint ? `Seller notes (may be Turkish/French): ${hint}` : 'Catalogue this product photo.' },
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
    const country = typeof body?.country === 'string' && body.country.trim() ? body.country.trim() : 'turkey';
    const fallbackWeight = Number.isFinite(Number(body?.weightKg)) && Number(body.weightKg) > 0 ? Number(body.weightKg) : 0.7;
    if (draftIds.length === 0) return json({ error: 'draftIds required (max 12 per call)' }, 400);
    if (!Number.isFinite(price) || price <= 0) return json({ error: 'A valid price is required' }, 400);

    const { data: drafts, error: dErr } = await admin
      .from('telegram_import_drafts')
      .select('id, image_url, caption, suggested_title, detected_category, forwarded_from_chat_username')
      .in('id', draftIds)
      .eq('status', 'pending');
    if (dErr) return json({ error: dErr.message }, 500);

    const results: Array<{ id: string; ok: boolean; title?: string; error?: string }> = [];

    for (const d of (drafts ?? []) as Draft[]) {
      const ai = await describe(LOVABLE_API_KEY, d);
      const title = ai?.title ?? d.suggested_title ?? 'Fashion item';
      const weight = ai?.weight_kg && ai.weight_kg > 0 ? Math.min(ai.weight_kg, 15) : fallbackWeight;
      const sourceUrl = d.forwarded_from_chat_username ? `https://t.me/${d.forwarded_from_chat_username}` : 'https://t.me/';

      const { data: prod, error: pErr } = await admin
        .from('international_products')
        .insert({
          country,
          title,
          image_url: d.image_url,
          images: [d.image_url],
          product_url: sourceUrl,
          base_price_usd: price,
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
          suggested_price_usd: price,
          suggested_weight_kg: weight,
        })
        .eq('id', d.id);

      results.push({ id: d.id, ok: true, title });
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
