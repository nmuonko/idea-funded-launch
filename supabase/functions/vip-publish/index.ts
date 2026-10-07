// vip-publish
// Admin-only endpoint for VIP product lifecycle operations:
// publish, unpublish, hide, delete, edit (price/description/name/colors/sizes),
// variant availability, and whole-batch status changes.
// Server-side validation: a product cannot be published without a category,
// a shipping rate and a computed final price.

import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors'
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, guardErrorResponse } from "../_shared/securityGuards.ts";

const ok = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const VALID_STATUSES = ["draft", "available", "unavailable", "hidden"];

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

    const action = String(body.action ?? "");
    const productIds: string[] = Array.isArray(body.product_ids)
      ? body.product_ids.map((id: unknown) => String(id)).filter(Boolean).slice(0, 200)
      : [];

    switch (action) {
      case "publish":
      case "unpublish":
      case "set_status": {
        if (!productIds.length) return ok({ ok: false, error: "product_ids_required" }, 400);
        const targetStatus =
          action === "publish" ? "available" : action === "unpublish" ? "hidden" : String(body.status ?? "");
        if (!VALID_STATUSES.includes(targetStatus)) return ok({ ok: false, error: "invalid_status" }, 400);

        // Validate publishability when going to a public status
        if (targetStatus === "available" || targetStatus === "unavailable") {
          const { data: products } = await supa
            .from("vip_products")
            .select("id, category_id, final_price, rate_per_kg, name_fr")
            .in("id", productIds);
          const blocked = (products ?? []).filter(
            (p) => !p.category_id || !p.final_price || !p.rate_per_kg || !p.name_fr,
          );
          if (blocked.length) {
            return ok({
              ok: false,
              error: "products_not_publishable",
              blocked_ids: blocked.map((p) => p.id),
              message: "Some products are missing a category, shipping rate, final price or name and must remain drafts.",
            }, 422);
          }
        }

        const update: Record<string, unknown> = { status: targetStatus, updated_at: new Date().toISOString() };
        if (targetStatus === "available") update.published_at = new Date().toISOString();

        const { error } = await supa.from("vip_products").update(update).in("id", productIds);
        if (error) return ok({ ok: false, error: error.message }, 500);
        return ok({ ok: true, updated: productIds.length, status: targetStatus });
      }

      case "delete": {
        if (!productIds.length) return ok({ ok: false, error: "product_ids_required" }, 400);
        const { error } = await supa.from("vip_products").delete().in("id", productIds);
        if (error) return ok({ ok: false, error: error.message }, 500);
        return ok({ ok: true, deleted: productIds.length });
      }

      case "edit": {
        const id = String(body.product_id ?? "");
        if (!id) return ok({ ok: false, error: "product_id_required" }, 400);
        const allowed: Record<string, unknown> = {};
        if (typeof body.name_fr === "string") allowed.name_fr = body.name_fr.trim().slice(0, 120);
        if (typeof body.description_fr === "string") allowed.description_fr = body.description_fr.trim().slice(0, 1000);
        if (Array.isArray(body.colors)) allowed.colors = body.colors.map((c: unknown) => String(c).trim()).filter(Boolean).slice(0, 20);
        if (Array.isArray(body.sizes)) allowed.sizes = body.sizes.map((s: unknown) => String(s).trim()).filter(Boolean).slice(0, 30);
        if (typeof body.category_id === "string" && body.category_id) allowed.category_id = body.category_id;
        if (body.final_price != null) {
          const p = Number(body.final_price);
          if (!Number.isFinite(p) || p <= 0 || p > 1000000) return ok({ ok: false, error: "invalid_final_price" }, 400);
          allowed.final_price = Math.round(p * 100) / 100;
        }
        if (body.purchase_price != null) {
          const p = Number(body.purchase_price);
          if (!Number.isFinite(p) || p <= 0 || p > 100000) return ok({ ok: false, error: "invalid_purchase_price" }, 400);
          allowed.purchase_price = Math.round(p * 100) / 100;
        }
        if (body.needs_review === false) { allowed.needs_review = false; allowed.review_reason = null; }
        if (!Object.keys(allowed).length) return ok({ ok: false, error: "nothing_to_update" }, 400);
        allowed.updated_at = new Date().toISOString();

        const { error } = await supa.from("vip_products").update(allowed).eq("id", id);
        if (error) return ok({ ok: false, error: error.message }, 500);
        return ok({ ok: true });
      }

      case "set_variant_availability": {
        const variantId = String(body.variant_id ?? "");
        if (!variantId) return ok({ ok: false, error: "variant_id_required" }, 400);
        const { error } = await supa
          .from("vip_product_variants")
          .update({ available: body.available === true })
          .eq("id", variantId);
        if (error) return ok({ ok: false, error: error.message }, 500);
        return ok({ ok: true });
      }

      case "batch_status": {
        const batchId = String(body.batch_id ?? "");
        const status = String(body.status ?? "");
        if (!batchId || !VALID_STATUSES.includes(status)) {
          return ok({ ok: false, error: "batch_id_and_valid_status_required" }, 400);
        }
        if (status === "available" || status === "unavailable") {
          const { data: bad } = await supa
            .from("vip_products")
            .select("id")
            .eq("batch_id", batchId)
            .or("category_id.is.null,final_price.is.null,rate_per_kg.is.null,name_fr.is.null");
          if (bad?.length) {
            return ok({ ok: false, error: "products_not_publishable", blocked_ids: bad.map((p) => p.id) }, 422);
          }
        }
        const update: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
        if (status === "available") update.published_at = new Date().toISOString();
        const { error } = await supa.from("vip_products").update(update).eq("batch_id", batchId);
        if (error) return ok({ ok: false, error: error.message }, 500);
        return ok({ ok: true });
      }

      default:
        return ok({ ok: false, error: "unknown_action" }, 400);
    }
  } catch (err) {
    return guardErrorResponse(err, corsHeaders);
  }
});
