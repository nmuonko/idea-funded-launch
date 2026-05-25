// dubai-upload-admin — admin-only operations:
//   POST /dubai-upload-admin?action=set-token   { token }
//   POST /dubai-upload-admin?action=approve     { id, patch? }
//   POST /dubai-upload-admin?action=reject      { id }

import { createClient } from "@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return ok({ ok: false, error: "method_not_allowed" });

  try {
    const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
    const auth = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPA_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const admin = createClient(SUPA_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: u } = await userClient.auth.getUser();
    const userId = u?.user?.id;
    if (!userId) return ok({ ok: false, error: "unauthenticated" });
    const { data: isAdmin } = await admin.rpc("is_admin", { _user_id: userId });
    if (!isAdmin) return ok({ ok: false, error: "forbidden" });

    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const body = await req.json().catch(() => ({})) as any;

    if (action === "set-token") {
      const token = String(body.token || "");
      if (token.length < 12) return ok({ ok: false, error: "token_too_short" });
      const hash = await sha256(token);
      const { error } = await admin
        .from("app_secrets")
        .upsert({ key: "dubai_upload_token", value: { hash } }, { onConflict: "key" });
      if (error) return ok({ ok: false, error: error.message });
      return ok({ ok: true });
    }

    if (action === "reject") {
      const id = String(body.id || "");
      const { error } = await admin
        .from("dubai_uploads")
        .update({ status: "rejected" })
        .eq("id", id);
      if (error) return ok({ ok: false, error: error.message });
      return ok({ ok: true });
    }

    if (action === "approve") {
      const id = String(body.id || "");
      const patch = (body.patch || {}) as Record<string, any>;
      const { data: row, error: fetchErr } = await admin
        .from("dubai_uploads").select("*").eq("id", id).maybeSingle();
      if (fetchErr || !row) return ok({ ok: false, error: "not_found" });

      const merged = { ...row, ...patch };
      const title = (patch.refined_title || merged.refined_title || buildTitle(merged) || "Dubai product").slice(0, 200);
      const finalPrice = Number(patch.final_price_usd ?? merged.final_price_usd ?? 0);
      if (!finalPrice || finalPrice <= 0) return ok({ ok: false, error: "final_price_required" });

      const images: string[] = Array.isArray(merged.images) ? merged.images : [];
      const showcase = {
        title,
        image_url: images[0] || null,
        gallery_images: images,
        price_usd: finalPrice,
        markup_usd: 0,
        shipping_usd: 0,
        total_price_usd: Math.ceil(finalPrice),
        provider: "dubai",
        provider_product_id: `dubai_${id}`,
        product_url: null,
        link_source: "dubai",
        is_active: true,
        sort_order: 0,
        description_fr: patch.public_description ?? merged.public_description ?? null,
        created_by: userId,
      };

      const { data: published, error: pubErr } = await admin
        .from("hot_products_showcase").insert(showcase).select("id").single();
      if (pubErr) return ok({ ok: false, error: pubErr.message });

      await admin.from("dubai_uploads").update({
        status: "approved",
        published_showcase_id: published.id,
        refined_title: title,
        final_price_usd: finalPrice,
        public_description: patch.public_description ?? merged.public_description ?? null,
        admin_notes: patch.admin_notes ?? merged.admin_notes ?? null,
        images: patch.images ?? merged.images,
        condition: patch.condition ?? merged.condition,
        battery_health: patch.battery_health ?? merged.battery_health,
      }).eq("id", id);

      return ok({ ok: true, showcase_id: published.id });
    }

    return ok({ ok: false, error: "unknown_action" });
  } catch (e) {
    console.error("[dubai-upload-admin]", e);
    return ok({ ok: false, error: "unexpected" });
  }
});

function buildTitle(row: any): string {
  const parts: string[] = [];
  if (row.model && row.model !== "other") parts.push(row.model);
  else if (row.model_other_text) parts.push(row.model_other_text);
  if (row.storage) parts.push(row.storage);
  if (row.color) parts.push(row.color);
  if (row.condition) parts.push(`- ${row.condition}`);
  parts.push("- Dubai Deal");
  return parts.join(" ");
}
