// vip-ai-process
// Admin-only endpoint powering the AI Clothing Importer.
// Accepts a batch of product photos (base64) plus shared batch details
// (category, purchase price, weight, rate/kg, colors, sizes).
// For each photo: uploads it to storage, runs AI vision to identify the item
// and generate a French name + description, computes the final selling price
// server-side (purchase + shipping + buffer% of shipping + markup% of purchase),
// and stores a DRAFT vip_product + variants. Nothing is published here.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, guardErrorResponse } from "../_shared/securityGuards.ts";

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.7-flash";
const MAX_IMAGES = 50;
const MAX_BYTES = 12 * 1024 * 1024;

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  try {
    const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!m) return null;
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime: m[1] };
  } catch {
    return null;
  }
}

const extFor = (mime: string) =>
  mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";

// Decimal-safe money math: work in cents integers.
function computePrice(
  purchasePrice: number,
  weightKg: number,
  ratePerKg: number,
  bufferPct: number,
  markupPct: number,
) {
  const shipping = Math.round(weightKg * ratePerKg * 100); // cents
  const buffer = Math.round((shipping * bufferPct) / 100);
  const profit = Math.round((Math.round(purchasePrice * 100) * markupPct) / 100);
  const finalCents = Math.round(purchasePrice * 100) + shipping + buffer + profit;
  return {
    shipping_cost: shipping / 100,
    shipping_buffer: buffer / 100,
    profit: profit / 100,
    final_price: finalCents / 100,
  };
}

const SYSTEM = `You are an AI clothing analyst and professional French e-commerce copywriter for AfriShop, a store serving customers in the Democratic Republic of Congo.

For the clothing item in the photo, return STRICT JSON only:
{
  "item_type": "<clothing type in English, e.g. Polo, Dress, Sneakers, Handbag, Baby Clothing>",
  "matches_category": <true|false — whether the item plausibly belongs to the batch category given>,
  "name_fr": "<professional French product name, 30-70 chars, no emojis, no prices, no brands unless clearly visible>",
  "description_fr": "<2-3 short, attractive, grammatically correct French sentences describing style, color, fit and occasion. Factual, no exaggerated or unverifiable claims, no prices, no emojis>",
  "colors": ["<visible colors in French, e.g. Noir, Bleu marine>"],
  "visible_text": "<any text/size/brand readable in the image, or empty>"
}

Rules:
- Never invent brands, sizes, materials or features not visible.
- Each description must be unique and specific to THIS photo.
- French must be natural and professional.`;

async function analyzeImage(
  apiKey: string,
  imageUrl: string,
  batchCategory: string,
): Promise<{
  item_type: string;
  matches_category: boolean;
  name_fr: string;
  description_fr: string;
  colors: string[];
  visible_text: string;
} | null> {
  try {
    const res = await fetch(AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              { type: "text", text: `Batch category selected by admin: ${batchCategory}` },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error(`[vip-ai-process] AI ${res.status}: ${await res.text()}`);
      return null;
    }
    const data = await res.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const p = JSON.parse(match[0]);
    if (!p.name_fr) return null;
    return {
      item_type: String(p.item_type ?? "").slice(0, 80),
      matches_category: p.matches_category !== false,
      name_fr: String(p.name_fr).replace(/\s+/g, " ").trim().slice(0, 120),
      description_fr: String(p.description_fr ?? "").trim().slice(0, 800),
      colors: Array.isArray(p.colors) ? p.colors.map((c: unknown) => String(c).slice(0, 40)).slice(0, 6) : [],
      visible_text: String(p.visible_text ?? "").slice(0, 200),
    };
  } catch (e) {
    console.error("[vip-ai-process] AI error", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return ok({ ok: false, error: "method_not_allowed" }, 405);

  try {
    await requireAdmin(req);

    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = (await req.json().catch(() => null)) as any;
    if (!body || typeof body !== "object") return ok({ ok: false, error: "invalid_body" }, 400);

    const categoryId = String(body.category_id ?? "");
    if (!categoryId) return ok({ ok: false, error: "category_required" }, 400);

    const purchasePrice = Number(body.purchase_price);
    if (!Number.isFinite(purchasePrice) || purchasePrice <= 0 || purchasePrice > 100000) {
      return ok({ ok: false, error: "invalid_purchase_price" }, 400);
    }

    const images: string[] = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
    if (images.length === 0) return ok({ ok: false, error: "images_required" }, 400);

    const batchColors: string[] = Array.isArray(body.colors)
      ? body.colors.map((c: unknown) => String(c).trim()).filter(Boolean).slice(0, 20)
      : [];
    const batchSizes: string[] = Array.isArray(body.sizes)
      ? body.sizes.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 30)
      : [];

    // Load category
    const { data: category } = await supa
      .from("vip_categories")
      .select("id, name, default_weight_kg, shipping_rate_per_kg")
      .eq("id", categoryId)
      .maybeSingle();
    if (!category) return ok({ ok: false, error: "category_not_found" }, 404);

    const weightKg = Number(body.weight_kg) > 0 ? Number(body.weight_kg) : Number(category.default_weight_kg);
    const ratePerKg = Number(body.rate_per_kg) > 0 ? Number(body.rate_per_kg) : Number(category.shipping_rate_per_kg);
    const hasRate = Number.isFinite(ratePerKg) && ratePerKg > 0;

    // Load current settings
    const { data: settings } = await supa
      .from("vip_settings")
      .select("shipping_buffer_percent, profit_markup_percent")
      .eq("id", 1)
      .maybeSingle();
    const bufferPct = Number(settings?.shipping_buffer_percent ?? 10);
    const markupPct = Number(settings?.profit_markup_percent ?? 30);

    // Create the batch record
    const { data: batch, error: batchErr } = await supa
      .from("vip_batches")
      .insert({
        created_by: (await import("../_shared/securityGuards.ts")).then ? (undefined as never) : undefined,
        category_id: categoryId,
        purchase_price: purchasePrice,
        weight_kg: weightKg,
        rate_per_kg: hasRate ? ratePerKg : null,
        colors: batchColors,
        sizes: batchSizes,
        status: "processing",
      })
      .select("id")
      .single();
    if (batchErr || !batch) {
      console.error("[vip-ai-process] batch insert error", batchErr);
      return ok({ ok: false, error: "batch_create_failed" }, 500);
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
    const results: Array<Record<string, unknown>> = [];

    for (let i = 0; i < images.length; i++) {
      const decoded = decodeDataUrl(images[i]);
      if (!decoded || !decoded.mime.startsWith("image/") || decoded.bytes.length > MAX_BYTES) {
        results.push({ index: i, ok: false, error: "invalid_image" });
        continue;
      }

      const path = `vip/${batch.id}/${i + 1}.${extFor(decoded.mime)}`;
      const { error: upErr } = await supa.storage
        .from("product-images")
        .upload(path, decoded.bytes, { contentType: decoded.mime, upsert: true });
      if (upErr) {
        console.error("[vip-ai-process] upload error", upErr);
        results.push({ index: i, ok: false, error: "upload_failed" });
        continue;
      }
      const { data: pub } = supa.storage.from("product-images").getPublicUrl(path);
      const imageUrl = pub?.publicUrl;
      if (!imageUrl) {
        results.push({ index: i, ok: false, error: "no_public_url" });
        continue;
      }

      const ai = apiKey ? await analyzeImage(apiKey, imageUrl, category.name) : null;

      const price = hasRate
        ? computePrice(purchasePrice, weightKg, ratePerKg, bufferPct, markupPct)
        : null;

      const needsReview = !ai || !ai.matches_category || !hasRate;
      const reviewReason = !ai
        ? "ai_failed"
        : !ai.matches_category
          ? "category_mismatch"
          : !hasRate
            ? "missing_shipping_rate"
            : null;

      const { data: product, error: prodErr } = await supa
        .from("vip_products")
        .insert({
          batch_id: batch.id,
          category_id: categoryId,
          name_fr: ai?.name_fr ?? null,
          description_fr: ai?.description_fr ?? null,
          image_url: imageUrl,
          purchase_price: purchasePrice,
          weight_kg: weightKg,
          rate_per_kg: hasRate ? ratePerKg : null,
          shipping_cost: price?.shipping_cost ?? null,
          shipping_buffer: price?.shipping_buffer ?? null,
          profit: price?.profit ?? null,
          final_price: price?.final_price ?? null,
          buffer_pct_applied: bufferPct,
          markup_pct_applied: markupPct,
          status: "draft",
          colors: batchColors,
          sizes: batchSizes,
          ai_suggested: ai
            ? { item_type: ai.item_type, colors: ai.colors, visible_text: ai.visible_text }
            : {},
          needs_review: needsReview,
          review_reason: reviewReason,
        })
        .select("id, name_fr, final_price, needs_review, review_reason")
        .single();

      if (prodErr || !product) {
        console.error("[vip-ai-process] product insert error", prodErr);
        results.push({ index: i, ok: false, error: "product_create_failed" });
        continue;
      }

      // Create variant rows for every size/color combination
      const variantRows: Array<{ product_id: string; size: string | null; color: string | null }> = [];
      const sizes = batchSizes.length ? batchSizes : [null];
      const colors = batchColors.length ? batchColors : [null];
      for (const s of sizes) for (const c of colors) {
        variantRows.push({ product_id: product.id, size: s, color: c });
      }
      if (variantRows.length) {
        await supa.from("vip_product_variants").insert(variantRows);
      }

      results.push({ index: i, ok: true, product });
    }

    await supa.from("vip_batches").update({ status: "review" }).eq("id", batch.id);

    return ok({ ok: true, batch_id: batch.id, results });
  } catch (err) {
    return guardErrorResponse(err, corsHeaders);
  }
});
