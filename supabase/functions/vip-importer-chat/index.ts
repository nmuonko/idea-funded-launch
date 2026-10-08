// vip-importer-chat
// Admin-only conversational engine behind /admin/vip-importer.
// - Photos (already uploaded by the admin to product-images/vip-chat/...) are
//   analyzed with AI vision + OCR, auto-matched to vip_categories and stored
//   as DRAFT vip_products with EN + FR titles/descriptions.
// - Text messages are interpreted into structured actions (prices, sizes,
//   colors, availability, categories, margins, publish) executed server-side.
// - Prices are always computed here, never on the client.
// - The assistant then asks only for the next missing piece of information.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, guardErrorResponse } from "../_shared/securityGuards.ts";
import { groupVipPhotos } from "../_shared/vipGallery.ts";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.7-flash";
const MAX_IMAGES = 50;

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Cat = { id: string; name: string; name_fr: string | null; default_weight_kg: number; shipping_rate_per_kg: number | null; is_active: boolean };
type Prod = {
  id: string; category_id: string | null; name_en: string | null; name_fr: string | null; image_url: string;
  purchase_price: number | null; final_price: number | null; status: string; colors: string[]; sizes: string[];
  shipping_cost?: number | null; shipping_buffer?: number | null; profit?: number | null; shipping_model?: string;
  ai_suggested: Record<string, unknown>; needs_review: boolean; review_reason: string | null; created_at: string;
};
type State = {
  sizes_done?: boolean; colors_done?: boolean; markup_pct?: number; buffer_pct?: number;
  pending_category?: string | null; kept_draft?: boolean;
  shipping_model?: "rate_per_kg" | "italy_fedex";
  carrier?: "express" | "standard";
  total_weight_kg?: number;
  eur_usd_rate?: number;
};

type Bracket = { min_kg: number; max_kg: number; express_eur: number | null; standard_eur: number | null };

const money = (n: number) => `$${n.toFixed(2)}`;

export function computePrice(purchase: number, weightKg: number, rate: number, bufferPct: number, markupPct: number) {
  const p = Math.round(purchase * 100);
  const shipping = Math.round(weightKg * rate * 100);
  const buffer = Math.round((shipping * bufferPct) / 100);
  const profit = Math.round((p * markupPct) / 100);
  return { shipping_cost: shipping / 100, shipping_buffer: buffer / 100, profit: profit / 100, final_price: (p + shipping + buffer + profit) / 100 };
}

// --- Italy FedEx weight-bracket shipping ---
function findBracket(brackets: Bracket[], w: number): Bracket | null {
  const s = [...brackets].sort((a, b) => a.min_kg - b.min_kg);
  return s.find((b) => w >= b.min_kg && w <= b.max_kg)
    ?? (w > 0 && s.length && w > s[s.length - 1].max_kg ? s[s.length - 1] : null);
}

// Largest-remainder split so per-item cents sum exactly to the total.
function allocateCents(totalCents: number, weights: number[]): number[] {
  const tw = weights.reduce((s, w) => s + w, 0);
  if (!weights.length || tw <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w / tw) * totalCents);
  const out = raw.map((r) => Math.floor(r));
  let rem = totalCents - out.reduce((s, f) => s + f, 0);
  for (const { i } of raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f)) {
    if (rem <= 0) break; out[i] += 1; rem -= 1;
  }
  return out;
}

async function fetchEurUsdRate(): Promise<number | null> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/EUR");
    if (!res.ok) return null;
    const data = await res.json();
    const rate = Number(data?.rates?.USD);
    return rate > 0 ? rate : null;
  } catch { return null; }
}

async function aiJson(apiKey: string, messages: unknown[]): Promise<any | null> {
  try {
    const res = await fetch(AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, messages }),
    });
    if (!res.ok) { console.error(`[vip-importer-chat] AI ${res.status}: ${await res.text()}`); return null; }
    const data = await res.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? "";
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch (e) { console.error("[vip-importer-chat] AI error", e); return null; }
}

const CAT_KEYWORDS: [RegExp, RegExp][] = [
  [/polo/i, /polo/i],
  [/t-?shirt|tee\b|top\b|blouse|shirt|tank|sweater|hoodie/i, /shirt|polo/i],
  [/jean|denim/i, /jean/i],
  [/pant|trouser|chino|short|jogger/i, /pant/i],
  [/suit|blazer|tuxedo/i, /suit/i],
  [/wedding|bridal/i, /wedding/i],
  [/dress|gown/i, /dress/i],
  [/shoe|loafer|sneaker|boot|sandal/i, /shoe/i],
];
function guessCategory(cats: Cat[], text: string): Cat | undefined {
  const active = cats.filter((c) => c.is_active);
  for (const [kw, catRe] of CAT_KEYWORDS) {
    if (!kw.test(text)) continue;
    const c = active.find((x) => catRe.test(x.name));
    if (c) return c;
  }
  return undefined;
}

const VISION_SYSTEM = (cats: Cat[]) => `You are a fashion product analyst for AfriShop's VIP store. Use AI vision to recognise WHAT the product is, and OCR only to read text printed in the image.
Existing categories. ALWAYS pick the CLOSEST existing one by garment family (e.g. T-shirt/tee/top/blouse -> Shirt or Polo; trousers/chinos/shorts -> Pants; denim -> Jeans; blazer/suit -> Men's Suits; gown/dress -> Women's Formal Dress; shoes/loafers -> Italian Men's Shoes). Use null ONLY if nothing is remotely similar: ${cats.map((c) => c.name).join(" | ")}
Return STRICT JSON only:
{"item_type":"<specific type in English, e.g. Men's Polo Shirt, Baby Clothing, Sneakers, Handbag>",
 "category":"<exact existing category name or null>",
 "suggested_category":"<short new category name in English if category is null, else null>",
 "new_category_weight_kg":<estimated weight of ONE item in kg, e.g. 0.3 for a handbag, 1.5 for a coat — only when category is null, else null>,
 "new_category_rate_per_kg":<estimated fair shipping rate in USD per kg for this kind of item, 20-60 — only when category is null, else null>,
 "confidence":<0..1>,
 "colors":["<visible colors in English>"],
 "brand":"<brand only if clearly visible, else null>",
 "size":"<size only if visible, else null>",
 "visible_text":"<OCR text, or empty>",
 "printed_price":<number or null>,
 "name_en":"<professional ad-friendly English title, 30-70 chars, include main color>",
 "description_en":"<2 short factual English sentences>",
 "name_fr":"<same title in natural French>",
 "description_fr":"<same description in natural French>"}
Never invent brands, sizes or materials. No emojis, no prices in text.`;

async function analyze(apiKey: string, url: string, cats: Cat[]) {
  return await aiJson(apiKey, [
    { role: "system", content: VISION_SYSTEM(cats) },
    { role: "user", content: [{ type: "text", text: "Analyze this product photo." }, { type: "image_url", image_url: { url } }] },
  ]);
}

const INTERPRET_SYSTEM = `You convert an AfriShop admin's chat message into actions on the products of the current import. Products are referenced by their 1-based number.
Return STRICT JSON only: {"actions":[...], "reply":"<one short friendly sentence acknowledging, or answering a question>"}
Action shapes ("targets" is "all" or an array of product numbers; resolve phrases like "the black one", "first five", "all except 6" using the product list):
{"type":"set_price","targets":...,"price":<number>}           purchase price paid per item
{"type":"set_sizes","targets":...,"sizes":["M","L"]}          expand ranges like "M to XXL" -> M,L,XL,XXL ; "40 to 43" -> 40,41,42,43 for shoes; for dresses/suits/clothing numeric EU sizes like "40-50" -> 40,42,44,46,48,50 (step 2)
{"type":"remove_size","targets":...,"size":"XL"}
{"type":"set_colors","targets":...,"colors":["White"]}
{"type":"confirm_colors"}
{"type":"set_status","targets":...,"status":"available|unavailable|hidden|draft"}   "available"/"make available" on drafts means publish
{"type":"publish","targets":...}                              ONLY if the admin explicitly asks to publish
{"type":"keep_draft"}
{"type":"set_category","targets":...,"category":"<existing category name>"}
{"type":"create_category","name":"...","weight_kg":<number>,"rate_per_kg":<number>}   only when name, weight and rate are all known
{"type":"start_category","name":"..."}                        admin wants to add a category but weight/rate not given yet
{"type":"set_markup","percent":<number>}                      profit % for this import only
{"type":"set_buffer","percent":<number>}                      shipping buffer % for this import only
{"type":"set_shipping_method","method":"rate_per_kg|italy_fedex"}   "Italy", "FedEx", "Italy shipping" -> italy_fedex; "per kg", "normal" -> rate_per_kg
{"type":"set_shipment","total_weight_kg":<number>,"carrier":"express|standard"}   total Italy shipment weight + FedEx service
{"type":"set_eur_rate","rate":<number>}                         manual EUR->USD rate (e.g. 1.08)
{"type":"delete","targets":...}
{"type":"skip_uncategorized"}                                 admin says skip the items without category
{"type":"set_title","targets":[n],"name_en":"..."}
If nothing actionable, return {"actions":[],"reply":"<helpful answer>"}. Never invent prices.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return ok({ ok: false, error: "method_not_allowed" }, 405);
  try {
    const admin = await requireAdmin(req);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const apiKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
    const body = (await req.json().catch(() => null)) as any;
    if (!body) return ok({ ok: false, error: "invalid_body" }, 400);

    const text = typeof body.text === "string" ? body.text.trim().slice(0, 2000) : "";
    const publicPrefix = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/product-images/vip-chat/`;
    const images: string[] = (Array.isArray(body.images) ? body.images : [])
      .map((u: unknown) => String(u)).filter((u: string) => u.startsWith(publicPrefix)).slice(0, MAX_IMAGES);
    if (!text && !images.length) return ok({ ok: false, error: "empty_message" }, 400);

    // Thread
    let threadId = typeof body.thread_id === "string" ? body.thread_id : "";
    let state: State = {};
    if (threadId) {
      const { data: t } = await supa.from("vip_import_threads").select("id, state").eq("id", threadId).maybeSingle();
      if (!t) return ok({ ok: false, error: "thread_not_found" }, 404);
      state = (t.state ?? {}) as State;
    } else {
      const { data: t, error } = await supa.from("vip_import_threads")
        .insert({ created_by: admin.id === "service_role" ? null : admin.id, title: "New import" })
        .select("id").single();
      if (error || !t) return ok({ ok: false, error: "thread_create_failed" }, 500);
      threadId = t.id;
    }

    await supa.from("vip_import_messages").insert({ thread_id: threadId, role: "user", content: text, attachments: images });

    const { data: catRows } = await supa.from("vip_categories").select("*").order("name");
    let cats = (catRows ?? []) as Cat[];
    const { data: settings } = await supa.from("vip_settings").select("shipping_buffer_percent, profit_markup_percent, eur_usd_rate").eq("id", 1).maybeSingle();
    const bufferPct = () => Number(state.buffer_pct ?? settings?.shipping_buffer_percent ?? 10);
    const markupPct = () => Number(state.markup_pct ?? settings?.profit_markup_percent ?? 30);

    const loadProducts = async (): Promise<Prod[]> => {
      const { data } = await supa.from("vip_products")
        .select("id, category_id, name_en, name_fr, image_url, purchase_price, final_price, status, colors, sizes, ai_suggested, needs_review, review_reason, created_at, shipping_cost, shipping_buffer, profit, shipping_model")
        .eq("thread_id", threadId).is("gallery_product_id", null).order("created_at").order("id");
      return (data ?? []) as Prod[];
    };

    // Italy FedEx: resolve the EUR->USD rate once per request (manual state > settings > live rate)
    let cachedEurRate: number | null | undefined;
    const eurRate = async (): Promise<number | null> => {
      if (cachedEurRate !== undefined) return cachedEurRate;
      const manual = Number(state.eur_usd_rate ?? settings?.eur_usd_rate);
      cachedEurRate = manual > 0 ? manual : await fetchEurUsdRate();
      return cachedEurRate;
    };

    const reprice = async (ids: string[]) => {
      if (!ids.length) return;
      const { data } = await supa.from("vip_products").select("id, category_id, purchase_price").in("id", ids);
      const rows = (data ?? []).filter((p) => p.purchase_price);
      if (!rows.length) return;

      if (state.shipping_model === "italy_fedex") {
        // Italy FedEx: bracket price for the TOTAL shipment, converted EUR->USD,
        // allocated per item by weight. Per-kg category rates are not used.
        if (!state.total_weight_kg || !state.carrier) return;
        const { data: brRows } = await supa.from("vip_shipping_brackets").select("min_kg, max_kg, express_eur, standard_eur").eq("is_active", true);
        const bracket = findBracket((brRows ?? []) as Bracket[], state.total_weight_kg);
        const costEur = bracket ? (state.carrier === "express" ? bracket.express_eur : bracket.standard_eur) : null;
        const rate = await eurRate();
        if (costEur == null || !rate) return;
        const weights = rows.map((p) => Number(cats.find((c) => c.id === p.category_id)?.default_weight_kg ?? 0));
        const totalUsdCents = Math.round(costEur * 100 * rate);
        const alloc = allocateCents(totalUsdCents, weights);
        const allocEur = allocateCents(Math.round(costEur * 100), weights);
        for (let i = 0; i < rows.length; i++) {
          const p = rows[i];
          const shippingUsd = alloc[i] / 100;
          const buffer = Math.round((alloc[i] * bufferPct()) / 100);
          const profit = Math.round((Math.round(Number(p.purchase_price) * 100) * markupPct()) / 100);
          const finalCents = Math.round(Number(p.purchase_price) * 100) + alloc[i] + buffer + profit;
          await supa.from("vip_products").update({
            shipping_cost: shippingUsd, shipping_buffer: buffer / 100, profit: profit / 100, final_price: finalCents / 100,
            weight_kg: weights[i], rate_per_kg: null,
            shipping_model: "italy_fedex", carrier: `fedex_${state.carrier}`,
            eur_usd_rate: rate, shipping_cost_eur: allocEur[i] / 100,
            buffer_pct_applied: bufferPct(), markup_pct_applied: markupPct(), updated_at: new Date().toISOString(),
          }).eq("id", p.id);
        }
        return;
      }

      for (const p of rows) {
        const cat = cats.find((c) => c.id === p.category_id);
        if (!cat || !cat.shipping_rate_per_kg) continue;
        const pr = computePrice(Number(p.purchase_price), Number(cat.default_weight_kg), Number(cat.shipping_rate_per_kg), bufferPct(), markupPct());
        await supa.from("vip_products").update({
          ...pr, weight_kg: cat.default_weight_kg, rate_per_kg: cat.shipping_rate_per_kg,
          shipping_model: "rate_per_kg", carrier: null, eur_usd_rate: null, shipping_cost_eur: null,
          buffer_pct_applied: bufferPct(), markup_pct_applied: markupPct(), updated_at: new Date().toISOString(),
        }).eq("id", p.id);
      }
    };

    const lines: string[] = [];
    let quick: string[] = [];
    let showIds: string[] = [];
    let display: "cards" | "grid" = "grid";
    let createdIds: string[] = [];

    // ---------- Photos ----------
    if (images.length) {
      const results: any[] = new Array(images.length);
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(5, images.length) }, async () => {
        while (cursor < images.length) { const i = cursor++; results[i] = apiKey ? await analyze(apiKey, images[i], cats) : null; }
      }));
      const created: string[] = [];
      const grouped = groupVipPhotos(images, results);
      let createdCatInfo: { name: string; weight: number; rate: number } | null = null;
      {
        const ai = grouped.primary;
        let cat = ai?.category ? cats.find((c) => c.name.toLowerCase() === String(ai.category).toLowerCase()) : undefined;
        if (!cat && ai) cat = guessCategory(cats, `${ai.item_type ?? ""} ${ai.suggested_category ?? ""}`);
        let createdCat: Cat | null = null;
        if (!cat && ai?.suggested_category) {
          // No existing category fits — auto-create one from the AI's estimate.
          const name = String(ai.suggested_category).trim().slice(0, 60);
          const w = Number(ai.new_category_weight_kg);
          const r = Number(ai.new_category_rate_per_kg);
          const weight = w > 0 && w < 100 ? Math.round(w * 100) / 100 : 1;
          const rate = r >= 5 && r <= 200 ? Math.round(r) : 30;
          const existing = cats.find((x) => x.name.toLowerCase() === name.toLowerCase());
          if (existing) {
            cat = existing;
          } else if (name) {
            const { data: nc } = await supa.from("vip_categories")
              .insert({ name, default_weight_kg: weight, shipping_rate_per_kg: rate, is_active: true })
              .select("*").single();
            if (nc) { createdCat = nc as Cat; cat = createdCat; cats = [...cats, createdCat]; createdCatInfo = { name, weight, rate }; }
          }
        }
        const lowConf = grouped.needsReview;
        const colors = grouped.colors;
        const { data: p, error: insertError } = await supa.from("vip_products").insert({
          thread_id: threadId, category_id: cat?.id ?? null, image_url: images[0], image_gallery: grouped.gallery, status: "draft",
          name_en: ai?.name_en ? String(ai.name_en).slice(0, 120) : null,
          description_en: ai?.description_en ? String(ai.description_en).slice(0, 800) : null,
          name_fr: ai?.name_fr ? String(ai.name_fr).slice(0, 120) : null,
          description_fr: ai?.description_fr ? String(ai.description_fr).slice(0, 800) : null,
          colors, sizes: grouped.sizes,
          ai_suggested: ai ? { item_type: ai.item_type, suggested_category: ai.suggested_category, brand: ai.brand, visible_text: ai.visible_text, printed_price: ai.printed_price, confidence: ai.confidence } : {},
          needs_review: !ai || !cat || !!lowConf,
          review_reason: !ai ? "ai_failed" : !cat ? "unknown_category" : lowConf ? "low_confidence" : null,
        }).select("id").single();
        if (insertError || !p) return ok({ ok: false, error: "Unable to save this product gallery. Please try again." }, 500);
        if (p) created.push(p.id);
      }
      createdIds = created;
      state.sizes_done = false; state.colors_done = false; state.kept_draft = false;
      const all = await loadProducts();
      const fresh = all.filter((p) => created.includes(p.id));
      lines.push(`I analyzed ${images.length} photo${images.length > 1 ? "s" : ""} and combined them into one product gallery.`);
      const groups = new Map<string, Prod[]>();
      for (const p of fresh) { const k = p.category_id ?? "none"; groups.set(k, [...(groups.get(k) ?? []), p]); }
      for (const [k, ps] of groups) {
        if (k === "none") continue;
        const c = cats.find((x) => x.id === k);
        if (!c) continue;
        const type = String(ps[0].ai_suggested?.item_type ?? c.name);
        const review = ps.filter((p) => p.needs_review).length;
        lines.push(`**${ps.length === 1 ? "This looks like" : ps.length === images.length ? `All ${ps.length} appear to be` : `${ps.length} appear to be`} ${type}** → category **${c.name}** (${c.default_weight_kg} kg/item, ${c.shipping_rate_per_kg ? `$${c.shipping_rate_per_kg}/kg` : "no shipping rate yet"})${review ? ` — ${review} need a second look` : ""}.`);
      }
      if (createdCatInfo) lines.push(`This didn't fit any existing category, so I added **${createdCatInfo.name}** to your catalogue (${createdCatInfo.weight} kg/item, $${createdCatInfo.rate}/kg estimated). You can adjust these in VIP Pricing settings.`);
      const printed = fresh.map((p) => p.ai_suggested?.printed_price).filter((x) => typeof x === "number");
      if (printed.length) lines.push(`I also read a printed price on ${printed.length} photo(s) — tell me if that is what you paid.`);
      showIds = fresh.map((p) => p.id);
      const { count } = await supa.from("vip_import_messages").select("id", { count: "exact", head: true }).eq("thread_id", threadId);
      if ((count ?? 0) <= 1) {
        const firstCat = cats.find((c) => c.id === fresh.find((p) => p.category_id)?.category_id);
        const title = firstCat?.name ?? String(fresh[0]?.ai_suggested?.item_type ?? "Import");
        await supa.from("vip_import_threads").update({ title: title.slice(0, 60) }).eq("id", threadId);
      }
    }

    // ---------- Text ----------
    if (text) {
      // When photos come with a message ("$120, sizes 40-50"), apply it to the new photos.
      const products = images.length ? (await loadProducts()).filter((p) => createdIds.includes(p.id)) : await loadProducts();
      const list = products.map((p, i) => {
        const c = cats.find((x) => x.id === p.category_id);
        return `${i + 1}. ${p.name_en ?? p.ai_suggested?.item_type ?? "Unknown"} | category=${c?.name ?? "NONE (suggested " + (p.ai_suggested?.suggested_category ?? p.ai_suggested?.item_type ?? "?") + ")"} | colors=${(p.colors ?? []).join("/") || "-"} | sizes=${(p.sizes ?? []).join("/") || "-"} | paid=${p.purchase_price ?? "-"} | price=${p.final_price ?? "-"} | status=${p.status}`;
      }).join("\n");
      const ctx = `Categories: ${cats.map((c) => `${c.name} (${c.default_weight_kg}kg, ${c.shipping_rate_per_kg ?? "no rate"}/kg)`).join("; ")}
Current margins: buffer ${bufferPct()}%, profit ${markupPct()}%.
Shipping method for this import: ${state.shipping_model ?? "not chosen yet"}${state.shipping_model === "italy_fedex" ? ` (total shipment ${state.total_weight_kg ?? "?"} kg, carrier ${state.carrier ?? "?"}, EUR->USD ${state.eur_usd_rate ?? "auto"})` : ""}
Pending new category: ${state.pending_category ?? "none"}
Products:\n${list || "(none yet — admin has not uploaded photos)"}`;
      const parsed = apiKey ? await aiJson(apiKey, [
        { role: "system", content: INTERPRET_SYSTEM },
        { role: "user", content: `${ctx}\n\nAdmin message: ${text}` },
      ]) : null;
      const actions: any[] = Array.isArray(parsed?.actions) ? parsed.actions.slice(0, 20) : [];
      const pick = (t: unknown): Prod[] => t === "all" || t == null ? products
        : Array.isArray(t) ? t.map((n) => products[Number(n) - 1]).filter(Boolean) : [];
      const ids = (t: unknown) => pick(t).map((p) => p.id);
      const touched = new Set<string>();
      const now = () => new Date().toISOString();

      for (const a of actions) {
        switch (a?.type) {
          case "set_price": {
            const price = Number(a.price);
            if (!(price > 0 && price < 100000)) break;
            const t = ids(a.targets);
            await supa.from("vip_products").update({ purchase_price: Math.round(price * 100) / 100, updated_at: now() }).in("id", t);
            await reprice(t); t.forEach((i) => touched.add(i)); display = "cards";
            break;
          }
          case "set_sizes": case "remove_size": case "set_colors": {
            for (const p of pick(a.targets)) {
              const upd: Record<string, unknown> = { updated_at: now() };
              if (a.type === "set_sizes") upd.sizes = (a.sizes ?? []).map((s: unknown) => String(s).slice(0, 20)).slice(0, 30);
              if (a.type === "remove_size") upd.sizes = (p.sizes ?? []).filter((s) => s.toLowerCase() !== String(a.size).toLowerCase());
              if (a.type === "set_colors") upd.colors = (a.colors ?? []).map((s: unknown) => String(s).slice(0, 40)).slice(0, 20);
              await supa.from("vip_products").update(upd).eq("id", p.id); touched.add(p.id);
            }
            if (a.type === "set_sizes") state.sizes_done = true;
            if (a.type === "set_colors") state.colors_done = true;
            break;
          }
          case "confirm_colors": state.colors_done = true; break;
          case "keep_draft": state.kept_draft = true; break;
          case "set_status": case "publish": {
            const status = a.type === "publish" ? "available" : String(a.status);
            if (!["available", "unavailable", "hidden", "draft"].includes(status)) break;
            let targets = pick(a.targets);
            if (status === "available" || status === "unavailable") {
              const blocked = targets.filter((p) => !p.category_id || !p.final_price || !(p.name_en || p.name_fr));
              if (blocked.length) lines.push(`${blocked.length} product(s) can't go live yet — they still need a category or purchase price.`);
              targets = targets.filter((p) => !blocked.includes(p));
            }
            if (!targets.length) break;
            const upd: Record<string, unknown> = { status, updated_at: now() };
            if (status === "available") upd.published_at = now();
            await supa.from("vip_products").update(upd).in("id", targets.map((p) => p.id));
            targets.forEach((p) => touched.add(p.id));
            if (status === "available") lines.push(`✅ ${targets.length} product(s) are now live on the VIP store.`);
            break;
          }
          case "set_category": {
            const c = cats.find((x) => x.name.toLowerCase() === String(a.category ?? "").toLowerCase());
            if (!c) { lines.push(`I couldn't find a category called "${a.category}".`); break; }
            const t = ids(a.targets);
            await supa.from("vip_products").update({ category_id: c.id, needs_review: false, review_reason: null, updated_at: now() }).in("id", t);
            await reprice(t); t.forEach((i) => touched.add(i));
            break;
          }
          case "start_category": state.pending_category = String(a.name ?? "").slice(0, 60) || null; break;
          case "create_category": {
            const name = String(a.name ?? state.pending_category ?? "").trim().slice(0, 60);
            const w = Number(a.weight_kg), r = Number(a.rate_per_kg);
            if (!name || !(w > 0) || !(r > 0)) break;
            let c = cats.find((x) => x.name.toLowerCase() === name.toLowerCase());
            if (!c) {
              const { data: nc } = await supa.from("vip_categories").insert({ name, default_weight_kg: w, shipping_rate_per_kg: r, is_active: true }).select("*").single();
              if (!nc) break; c = nc as Cat; cats = [...cats, c];
            }
            state.pending_category = null;
            lines.push(`Saved new category **${c.name}** (${w} kg/item, $${r}/kg). I'll recognise it in future uploads.`);
            const match = products.filter((p) => !p.category_id && [p.ai_suggested?.suggested_category, p.ai_suggested?.item_type].some((s) => String(s ?? "").toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(String(s ?? "~").toLowerCase())));
            const t = (match.length ? match : products.filter((p) => !p.category_id)).map((p) => p.id);
            if (t.length) {
              await supa.from("vip_products").update({ category_id: c.id, needs_review: false, review_reason: null }).in("id", t);
              await reprice(t); t.forEach((i) => touched.add(i));
            }
            break;
          }
          case "set_shipping_method": {
            const m = String(a.method ?? "");
            if (m !== "rate_per_kg" && m !== "italy_fedex") break;
            state.shipping_model = m;
            if (m === "rate_per_kg") { state.carrier = undefined; state.total_weight_kg = undefined; }
            lines.push(m === "italy_fedex"
              ? "Italy FedEx pricing it is. What is the **total shipment weight** and which service — Express or Standard? (e.g. \"8 kg standard\")"
              : "Using the normal per-kg category rates for this import.");
            break;
          }
          case "set_shipment": {
            const w = Number(a.total_weight_kg);
            const car = String(a.carrier ?? "").toLowerCase();
            if (w > 0 && w < 10000) state.total_weight_kg = Math.round(w * 100) / 100;
            if (car === "express" || car === "standard") state.carrier = car;
            if (state.shipping_model !== "italy_fedex") state.shipping_model = "italy_fedex";
            if (state.total_weight_kg && state.carrier) {
              const { data: brRows } = await supa.from("vip_shipping_brackets").select("min_kg, max_kg, express_eur, standard_eur").eq("is_active", true);
              const b = findBracket((brRows ?? []) as Bracket[], state.total_weight_kg);
              const cost = b ? (state.carrier === "express" ? b.express_eur : b.standard_eur) : null;
              if (b && cost != null) {
                lines.push(`Shipment ${state.total_weight_kg} kg via FedEx ${state.carrier === "express" ? "Express" : "Standard"} → bracket ${b.min_kg}–${b.max_kg} kg = **€${cost}** for the whole shipment, split across items by weight.`);
                const t = products.map((p) => p.id); await reprice(t); t.forEach((i) => touched.add(i));
              } else if (b) {
                lines.push(`FedEx ${state.carrier} is not available for the ${b.min_kg}–${b.max_kg} kg bracket — ${state.carrier === "standard" ? "Express" : "Standard"} only.`);
              } else {
                lines.push(`No shipping bracket covers ${state.total_weight_kg} kg — check the brackets in VIP Pricing settings.`);
              }
            }
            break;
          }
          case "set_eur_rate": {
            const r = Number(a.rate);
            if (!(r > 0.5 && r < 3)) break;
            state.eur_usd_rate = r;
            lines.push(`EUR→USD rate set to ${r} for this import.`);
            const t = products.map((p) => p.id); await reprice(t); t.forEach((i) => touched.add(i));
            break;
          }
          case "set_markup": case "set_buffer": {
            const pct = Number(a.percent);
            if (!(pct >= 0 && pct <= 500)) break;
            if (a.type === "set_markup") state.markup_pct = pct; else state.buffer_pct = pct;
            const t = products.map((p) => p.id); await reprice(t); t.forEach((i) => touched.add(i));
            lines.push(`${a.type === "set_markup" ? "Profit" : "Shipping buffer"} set to ${pct}% for this import only.`);
            break;
          }
          case "delete": {
            const t = ids(a.targets);
            await supa.from("vip_products").delete().in("id", t);
            lines.push(`Removed ${t.length} product(s).`);
            break;
          }
          case "skip_uncategorized": {
            const t = products.filter((p) => !p.category_id).map((p) => p.id);
            await supa.from("vip_products").update({ status: "hidden" }).in("id", t);
            lines.push(`Skipped ${t.length} item(s) without a category.`);
            break;
          }
          case "set_title": {
            const p = pick(a.targets)[0];
            if (p && a.name_en) { await supa.from("vip_products").update({ name_en: String(a.name_en).slice(0, 120) }).eq("id", p.id); touched.add(p.id); }
            break;
          }
        }
      }
      if (images.length) { if (parsed?.reply) lines.push(String(parsed.reply).slice(0, 600)); }
      else if (parsed?.reply) lines.unshift(String(parsed.reply).slice(0, 600));
      else if (!parsed) lines.unshift("Sorry, I couldn't understand that right now — please try again.");
      showIds = images.length ? [...new Set([...showIds, ...touched])] : [...touched];
    }

    // ---------- Next question ----------
    const products = (await loadProducts()).filter((p) => p.status !== "hidden" || showIds.includes(p.id));
    const active = products.filter((p) => p.status !== "hidden");
    for (const p of active.filter((x) => !x.category_id)) {
      const g = guessCategory(cats, `${p.ai_suggested?.item_type ?? ""} ${p.ai_suggested?.suggested_category ?? ""} ${p.name_en ?? ""}`);
      if (g) { await supa.from("vip_products").update({ category_id: g.id, needs_review: false, review_reason: null }).eq("id", p.id); p.category_id = g.id; }
    }
    state.pending_category = null;
    const noCat = active.filter((p) => !p.category_id);
    const noPrice = active.filter((p) => p.category_id && !p.purchase_price);
    const priced = active.filter((p) => p.final_price);
    const drafts = active.filter((p) => p.status === "draft" && p.final_price);

    if (showIds.length && priced.some((p) => showIds.includes(p.id))) {
      const sample = priced.find((p) => showIds.includes(p.id))!;
      if (sample.purchase_price && sample.final_price) {
        const pr = { shipping_cost: Number(sample.shipping_cost ?? 0), shipping_buffer: Number(sample.shipping_buffer ?? 0), profit: Number(sample.profit ?? 0), final_price: Number(sample.final_price) };
        const via = sample.shipping_model === "italy_fedex" ? " (Italy FedEx, allocated by weight)" : "";
        if (display === "cards") lines.push(`Purchase ${money(Number(sample.purchase_price))} · Shipping ${money(pr.shipping_cost)}${via} · Buffer ${money(pr.shipping_buffer)} · Profit ${money(pr.profit)}\n\n**Selling price: ${money(pr.final_price)}${showIds.length > 1 ? " each" : ""}**\n\nEnglish and French names and descriptions are ready.`);
      }
    }

    if (!active.length) {
      if (!images.length && !lines.length) lines.push("Upload product photos and I'll take it from there.");
    } else if (noCat.length) {
      const sug = String(noCat[0].ai_suggested?.suggested_category ?? noCat[0].ai_suggested?.item_type ?? "New category");
      if (state.pending_category) {
        lines.push(`For **${state.pending_category}**: approximately how much does one item weigh, and what is the shipping price per kg? (e.g. "0.3 kg, $30/kg")`);
      } else {
        lines.push(`${noCat.length} item(s) look like **${sug}**, which isn't one of your pricing categories yet. Would you like to add it?`);
        quick = [`Add category ${sug}`, ...cats.filter((c) => c.is_active).slice(0, 3).map((c) => `Use ${c.name}`), "Skip"];
      }
    } else if (state.shipping_model === "italy_fedex" && (!state.total_weight_kg || !state.carrier)) {
      lines.push("For the Italy shipment: what is the **total shipment weight** and which FedEx service — Express or Standard? (e.g. \"8 kg standard\")");
      quick = ["5 kg express", "8 kg standard", "10 kg standard"];
    } else if (noPrice.length) {
      const c = cats.find((x) => x.id === noPrice[0].category_id);
      lines.push(`**How much did you pay for each ${c?.name ?? "item"}?**${noPrice.length !== active.length ? ` (${noPrice.length} still need a price)` : ""}`);
    } else if (!state.sizes_done) {
      const c = cats.find((x) => x.id === active[0].category_id)?.name.toLowerCase() ?? "";
      lines.push("Which sizes are available?");
      quick = /shoe|sneaker|chaussure/.test(c) ? ["39", "40", "41", "42", "43", "44", "45", "No sizes"]
        : /baby|bébé/.test(c) ? ["0-3m", "3-6m", "6-12m", "12-18m", "18-24m"]
        : ["XS", "S", "M", "L", "XL", "XXL", "One size"];
    } else if (!state.colors_done) {
      const cols = [...new Set(active.flatMap((p) => p.colors ?? []))];
      lines.push(cols.length ? `I detected these colors: **${cols.join(", ")}**. Are these correct?` : "Which colors are available?");
      quick = cols.length ? ["Confirm colors", ...cols.map((c) => `Only ${c}`)] : ["White", "Black", "Navy Blue", "Red"];
    } else if (drafts.length && !state.kept_draft) {
      const prices = drafts.map((p) => Number(p.final_price));
      lines.push(`**${drafts.length} product${drafts.length > 1 ? "s are" : " is"} ready for the VIP store.** ${Math.min(...prices) === Math.max(...prices) ? `Final price: ${money(prices[0])}` : `Final prices range from ${money(Math.min(...prices))} to ${money(Math.max(...prices))}`}. Would you like to publish?`);
      quick = ["Publish all to VIP", "Review products", "Keep as draft"];
      if (!showIds.length) showIds = drafts.map((p) => p.id);
    }

    await supa.from("vip_import_threads").update({ state, updated_at: new Date().toISOString() }).eq("id", threadId);
    const content = lines.join("\n\n") || "Done.";
    const blocks = { product_ids: showIds, quick, display: showIds.length > 4 ? "grid" : "cards" };
    const { data: msg } = await supa.from("vip_import_messages").insert({ thread_id: threadId, role: "assistant", content, blocks }).select("*").single();
    return ok({ ok: true, thread_id: threadId, message: msg });
  } catch (err) {
    return guardErrorResponse(err, corsHeaders);
  }
});
