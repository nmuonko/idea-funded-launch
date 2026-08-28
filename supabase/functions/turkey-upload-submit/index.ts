// turkey-upload-submit
// Token-gated endpoint used by the /turkey-upload page.
// Accepts photos (base64), article name, available sizes and the FINAL customer price,
// rewrites the title/description with AI, uploads images to the public `product-images`
// bucket and publishes the item straight to the /turkey page.
//
// Always returns HTTP 200 with JSON { ok, ... }.

import { createClient } from "@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-turkey-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  try {
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

const AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.7-flash";

const SYSTEM = `You are a product copywriter for an online store selling fashion and lifestyle items in DR Congo.
Return STRICT JSON only:
{"title":"<max 70 chars, English, clean, no emojis, no prices>","description":"<2-3 short English sentences about the item, material, style and fit. No prices, no currencies, no phone numbers, no shop names, no emojis.>"}
Never invent brand names. Keep it factual based on the photo and the seller's notes.`;

async function rewrite(
  apiKey: string,
  name: string,
  notes: string,
  sizes: string[],
  imageUrl: string | null,
): Promise<{ title: string; description: string } | null> {
  const hint = [
    `Article name: ${name}`,
    sizes.length ? `Available sizes: ${sizes.join(", ")}` : "",
    notes ? `Seller notes (may be French/Turkish): ${notes}` : "",
  ].filter(Boolean).join("\n").slice(0, 1200);

  const content: unknown[] = [{ type: "text", text: hint }];
  if (imageUrl) content.push({ type: "image_url", image_url: { url: imageUrl } });

  try {
    const res = await fetch(AI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content },
        ],
      }),
    });
    if (!res.ok) {
      console.error(`[turkey-upload-submit] AI ${res.status}: ${await res.text()}`);
      return null;
    }
    const data = await res.json();
    const raw: string = data?.choices?.[0]?.message?.content ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const title = String(parsed.title ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (!title) return null;
    return { title, description: String(parsed.description ?? "").trim().slice(0, 800) };
  } catch (e) {
    console.error("[turkey-upload-submit] AI error", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return ok({ ok: false, error: "method_not_allowed" });

  try {
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = req.headers.get("x-turkey-token") || "";
    if (!token || token.length < 6) return ok({ ok: false, error: "missing_token" });

    const incomingHash = await sha256(token);
    const { data: secretRow } = await supa
      .from("app_secrets")
      .select("value")
      .eq("key", "turkey_upload_token")
      .maybeSingle();
    const storedHash = (secretRow?.value as any)?.hash as string | undefined;
    if (!storedHash || !timingSafeEqual(incomingHash, storedHash)) {
      return ok({ ok: false, error: "invalid_token" });
    }

    const body = await req.json().catch(() => null) as any;
    if (!body || typeof body !== "object") return ok({ ok: false, error: "invalid_body" });

    const name = String(body.name ?? "").trim().slice(0, 200);
    if (!name) return ok({ ok: false, error: "name_required" });

    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0 || price > 100000) {
      return ok({ ok: false, error: "invalid_price" });
    }

    const sizes: string[] = Array.isArray(body.sizes)
      ? body.sizes.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 24)
      : [];
    const notes = String(body.notes ?? "").trim().slice(0, 1000);

    const images: string[] = Array.isArray(body.images) ? body.images.slice(0, 8) : [];
    if (images.length === 0) return ok({ ok: false, error: "images_required" });

    const uploadId = crypto.randomUUID();
    const urls: string[] = [];
    const MAX = 12 * 1024 * 1024;

    for (let i = 0; i < images.length; i++) {
      const decoded = decodeDataUrl(images[i]);
      if (!decoded || !decoded.mime.startsWith("image/") || decoded.bytes.length > MAX) continue;
      const path = `turkey/${uploadId}/${i + 1}.${extFor(decoded.mime)}`;
      const { error } = await supa.storage
        .from("product-images")
        .upload(path, decoded.bytes, { contentType: decoded.mime, upsert: true });
      if (error) {
        console.error("[turkey-upload-submit] upload error", error);
        continue;
      }
      const { data: pub } = supa.storage.from("product-images").getPublicUrl(path);
      if (pub?.publicUrl) urls.push(pub.publicUrl);
    }

    if (urls.length === 0) return ok({ ok: false, error: "image_upload_failed" });

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    const ai = apiKey ? await rewrite(apiKey, name, notes, sizes, urls[0]) : null;

    const { data: prod, error } = await supa
      .from("international_products")
      .insert({
        country: "turkey",
        title: ai?.title || name,
        image_url: urls[0],
        images: urls,
        product_url: "https://afrishop-usa.com/turkey",
        base_price_usd: Math.round(price * 100) / 100,
        is_final_price: true,
        est_weight_kg: 0.7,
        description: ai?.description || notes || null,
        available_sizes: sizes,
        is_active: true,
      })
      .select("id, title")
      .single();

    if (error || !prod) {
      console.error("[turkey-upload-submit] insert error", error);
      return ok({ ok: false, error: "insert_failed" });
    }

    return ok({ ok: true, id: prod.id, title: prod.title, aiRewritten: !!ai, images: urls.length });
  } catch (e) {
    console.error("[turkey-upload-submit] error", e);
    return ok({ ok: false, error: "unexpected_error" });
  }
});
