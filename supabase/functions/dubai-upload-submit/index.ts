// dubai-upload-submit
// Token-gated endpoint that accepts a Dubai product submission (with base64 images),
// uploads images to the `dubai-uploads` storage bucket, and inserts a
// pending_review row in dubai_uploads.
//
// Always returns HTTP 200 with JSON {ok, ...} per project mobile contract.

import { createClient } from "@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-dubai-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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

function extFor(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("quicktime")) return "mov";
  return "jpg";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return ok({ ok: false, error: "method_not_allowed" });

  try {
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const token = req.headers.get("x-dubai-token") || "";
    if (!token || token.length < 6) return ok({ ok: false, error: "missing_token" });

    const incomingHash = await sha256(token);
    let valid = false;

    const { data: settingRow } = await supa
      .from("app_secrets")
      .select("value")
      .eq("key", "dubai_upload_token")
      .maybeSingle();
    const storedHash = (settingRow?.value as any)?.hash as string | undefined;
    if (storedHash && timingSafeEqual(incomingHash, storedHash)) valid = true;

    if (!valid) return ok({ ok: false, error: "invalid_token" });

    const body = await req.json().catch(() => null) as any;
    if (!body || typeof body !== "object") return ok({ ok: false, error: "invalid_body" });

    const category = String(body.category || "").slice(0, 40);
    if (!category) return ok({ ok: false, error: "category_required" });

    const images: string[] = Array.isArray(body.images) ? body.images.slice(0, 8) : [];
    const rawImages: string[] = Array.isArray(body.raw_images)
      ? body.raw_images.slice(0, 8)
      : [];
    if (images.length === 0) return ok({ ok: false, error: "images_required" });

    const uploadId = crypto.randomUUID();
    const uploadedUrls: string[] = [];
    const uploadedRawUrls: string[] = [];
    const MAX = 12 * 1024 * 1024; // 12 MB per image after compression on client

    async function uploadList(list: string[], folder: string, sink: string[]) {
      for (let i = 0; i < list.length; i++) {
        const decoded = decodeDataUrl(list[i]);
        if (!decoded) continue;
        if (decoded.bytes.length > MAX) continue;
        if (!decoded.mime.startsWith("image/")) continue;
        const path = `pending/${uploadId}/${folder}/${i + 1}.${extFor(decoded.mime)}`;
        const { error } = await supa.storage
          .from("dubai-uploads")
          .upload(path, decoded.bytes, { contentType: decoded.mime, upsert: true });
        if (error) {
          console.error("[dubai-upload-submit] upload error", error);
          continue;
        }
        const { data: pub } = supa.storage.from("dubai-uploads").getPublicUrl(path);
        if (pub?.publicUrl) sink.push(pub.publicUrl);
      }
    }

    await uploadList(images, "img", uploadedUrls);
    await uploadList(rawImages, "raw", uploadedRawUrls);

    let videoUrl: string | null = null;
    if (typeof body.video === "string" && body.video.startsWith("data:")) {
      const decoded = decodeDataUrl(body.video);
      if (decoded && decoded.bytes.length <= 50 * 1024 * 1024) {
        const path = `pending/${uploadId}/video.${extFor(decoded.mime)}`;
        const { error } = await supa.storage
          .from("dubai-uploads")
          .upload(path, decoded.bytes, { contentType: decoded.mime, upsert: true });
        if (!error) {
          const { data: pub } = supa.storage.from("dubai-uploads").getPublicUrl(path);
          videoUrl = pub?.publicUrl || null;
        }
      }
    }

    if (uploadedUrls.length === 0) {
      return ok({ ok: false, error: "image_upload_failed" });
    }

    const toNum = (v: any) =>
      v === "" || v == null || isNaN(Number(v)) ? null : Number(v);

    const insertPayload: Record<string, unknown> = {
      id: uploadId,
      source: "dubai",
      category,
      model: body.model ? String(body.model).slice(0, 80) : null,
      model_other_text: body.model_other_text
        ? String(body.model_other_text).slice(0, 120)
        : null,
      refined_title: body.refined_title
        ? String(body.refined_title).slice(0, 200)
        : null,
      storage: body.storage ? String(body.storage).slice(0, 20) : null,
      color: body.color ? String(body.color).slice(0, 60) : null,
      condition: body.condition ? String(body.condition).slice(0, 30) : null,
      battery_health: toNum(body.battery_health),
      sim_type: body.sim_type ? String(body.sim_type).slice(0, 30) : null,
      network_status: body.network_status
        ? String(body.network_status).slice(0, 20)
        : null,
      face_id: body.face_id ? String(body.face_id).slice(0, 20) : null,
      dubai_price_aed: toNum(body.dubai_price_aed),
      dubai_price_usd: toNum(body.dubai_price_usd),
      final_price_usd: toNum(body.final_price_usd),
      images: uploadedUrls,
      raw_images: uploadedRawUrls,
      video_url: videoUrl,
      supplier_notes: body.supplier_notes
        ? String(body.supplier_notes).slice(0, 2000)
        : null,
      public_description: body.public_description
        ? String(body.public_description).slice(0, 2000)
        : null,
      admin_notes: null,
      status: "pending_review",
      submitted_by_token_hash: incomingHash,
    };

    const { data, error } = await supa
      .from("dubai_uploads")
      .insert(insertPayload)
      .select("id")
      .single();

    if (error) {
      console.error("[dubai-upload-submit] insert error", error);
      return ok({ ok: false, error: "insert_failed" });
    }

    return ok({ ok: true, id: data.id });
  } catch (e) {
    console.error("[dubai-upload-submit] unexpected", e);
    return ok({ ok: false, error: "unexpected" });
  }
});
