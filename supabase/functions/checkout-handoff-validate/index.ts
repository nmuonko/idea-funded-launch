/**
 * checkout-handoff-validate
 *
 * AGREED CONTRACT:
 *
 * ── Request ──
 * POST /checkout-handoff-validate
 * Body: { handoff: "<token>" }
 *
 * ── Success Response (200) ──
 *   { ok: true, user_id, email, handoff_id, device_id, consumed: true }
 *
 * ── Error Response (200) ──
 *   { ok: false, error: "HANDOFF_INVALID" | "HANDOFF_EXPIRED" | "HANDOFF_ALREADY_USED", error_code, message }
 */

import {
  corsHeaders,
  createAdminClient,
  jsonResponse,
} from "../_shared/auth.ts";

const tag = "[checkout-handoff]";

function maskId(id: string | null | undefined): string {
  if (!id || id.length < 8) return "***";
  return id.slice(0, 4) + "…" + id.slice(-4);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      console.log(`${tag} invalid — no JSON body`);
      return jsonResponse({
        ok: false,
        error: "HANDOFF_INVALID",
        error_code: "HANDOFF_INVALID",
        message: "Missing handoff token in request body.",
      }, 200);
    }

    const handoffToken = body?.handoff;
    if (!handoffToken || typeof handoffToken !== "string") {
      console.log(`${tag} invalid — no token in body`);
      return jsonResponse({
        ok: false,
        error: "HANDOFF_INVALID",
        error_code: "HANDOFF_INVALID",
        message: "Missing or invalid handoff token.",
      }, 200);
    }

    console.log(`${tag} validate tokenPrefix=${handoffToken.slice(0, 8)}…`);

    const admin = createAdminClient();

    // 1. Look up
    const { data: record, error: fetchErr } = await admin
      .from("checkout_handoff_tokens")
      .select("*")
      .eq("token", handoffToken)
      .eq("purpose", "checkout_webview_handoff")
      .single();

    if (fetchErr || !record) {
      console.log(`${tag} invalid — not found in DB`);
      return jsonResponse({
        ok: false,
        error: "HANDOFF_INVALID",
        error_code: "HANDOFF_INVALID",
        message: "Handoff token not found or invalid.",
      }, 200);
    }

    // 2. Already consumed?
    if (record.consumed_at) {
      console.log(`${tag} already-used id=${record.id} consumedAt=${record.consumed_at}`);
      return jsonResponse({
        ok: false,
        error: "HANDOFF_ALREADY_USED",
        error_code: "HANDOFF_ALREADY_USED",
        message: "This handoff token has already been used.",
      }, 200);
    }

    // 3. Expired?
    const now = new Date();
    if (now > new Date(record.expires_at)) {
      console.log(`${tag} expired id=${record.id} expiresAt=${record.expires_at}`);
      return jsonResponse({
        ok: false,
        error: "HANDOFF_EXPIRED",
        error_code: "HANDOFF_EXPIRED",
        message: "This handoff token has expired. Please try again.",
      }, 200);
    }

    // 4. Mark consumed
    await admin
      .from("checkout_handoff_tokens")
      .update({ consumed_at: now.toISOString() })
      .eq("id", record.id);

    // 5. Fetch user email
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let userEmail: string | null = null;

    try {
      const userRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${record.user_id}`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      });
      if (userRes.ok) {
        const u = await userRes.json();
        userEmail = u?.email || null;
      } else {
        await userRes.text(); // consume body
      }
    } catch (e: any) {
      console.warn(`${tag} user-lookup-failed`, e?.message);
    }

    console.log(`${tag} consumed handoffId=${record.id} userId=${maskId(record.user_id)} email=${userEmail ? userEmail.slice(0, 3) + "***" : "null"}`);

    return jsonResponse({
      ok: true,
      user_id: record.user_id,
      email: userEmail,
      handoff_id: record.id,
      device_id: record.device_id,
      consumed: true,
    });
  } catch (err: any) {
    console.error(`${tag} unhandled-error`, err?.message);
    return jsonResponse({
      ok: false,
      error: "INTERNAL_ERROR",
      error_code: "INTERNAL_ERROR",
      message: err?.message || "Internal error",
    }, 200);
  }
});
