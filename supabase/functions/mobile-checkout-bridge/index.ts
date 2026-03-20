/**
 * mobile-checkout-bridge
 *
 * Generates a one-time, short-lived handoff token stored in the DB.
 * The RN app calls this endpoint and receives a URL like:
 *   /checkout?handoff=<token>
 * The web frontend exchanges that token via checkout-handoff-validate
 * to bootstrap a session without needing WebView localStorage.
 *
 * POST /mobile-checkout-bridge
 * Headers: Authorization / x-auth-token / etc.
 * Body (optional): { redirect?: string, selected_item_ids?: string[], device_id?: string, refresh_token?: string }
 * Response: { ok, url, handoff_id, expires_at } or structured error
 */

import {
  corsHeaders,
  extractRequestToken,
  verifyAndGetUser,
  authErrorResponse,
  jsonResponse,
  createAdminClient,
} from "../_shared/auth.ts";

const SITE_URL =
  Deno.env.get("SITE_URL") || "https://idea-funded-launch.lovable.app";
const HANDOFF_TTL_SECONDS = 120; // 2 minutes

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function maskId(id: string): string {
  if (!id || id.length < 8) return "***";
  return id.slice(0, 4) + "…" + id.slice(-4);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const tag = "[mobile-checkout-bridge]";

  try {
    // 1. Extract & verify auth
    const { token, source } = await extractRequestToken(req);
    console.log(`${tag} auth-check`, JSON.stringify({ source, hasToken: !!token }));

    if (!token) {
      console.log(`${tag} auth-fail NO_TOKEN`);
      return authErrorResponse("NO_TOKEN", "No authentication token found.");
    }

    let user: any;
    try {
      const result = await verifyAndGetUser(req, undefined, { token, source });
      user = result.user;
    } catch (err: any) {
      const code = err?.authErrorCode || (err?.message?.includes("expired") ? "EXPIRED_TOKEN" : "INVALID_TOKEN");
      console.log(`${tag} auth-fail`, code);
      return authErrorResponse(code, err?.message || "Authentication failed.");
    }

    console.log(`${tag} auth-ok`, JSON.stringify({ userId: maskId(user.id), source }));

    // 2. Parse optional body
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      /* no body is fine */
    }

    const redirect = body?.redirect || "/checkout";
    const deviceId = body?.device_id || req.headers.get("x-device-id") || null;
    const selectedItemIds = body?.selected_item_ids || null;
    const refreshToken = body?.refresh_token || null;

    // 3. Validate user has cart items (lightweight check)
    const admin = createAdminClient();
    const { data: cartItems } = await admin
      .from("cart_items")
      .select("id")
      .eq("user_id", user.id)
      .limit(1);

    if (!cartItems || cartItems.length === 0) {
      console.log(`${tag} no-cart-items`, maskId(user.id));
      return jsonResponse({
        ok: false,
        error: "EMPTY_CART",
        error_code: "EMPTY_CART",
        message: "Your cart is empty.",
      }, 200);
    }

    // 4. Generate handoff token and store in DB
    const handoffToken = generateToken();
    const expiresAt = new Date(Date.now() + HANDOFF_TTL_SECONDS * 1000).toISOString();

    const { data: inserted, error: insertErr } = await admin
      .from("checkout_handoff_tokens")
      .insert({
        token: handoffToken,
        user_id: user.id,
        device_id: deviceId,
        purpose: "checkout_webview_handoff",
        expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (insertErr || !inserted) {
      console.error(`${tag} db-insert-error`, insertErr?.message);
      return jsonResponse({
        ok: false,
        error: "INTERNAL_ERROR",
        message: "Failed to create handoff token.",
      }, 200);
    }

    // 5. Build checkout URL with handoff token (NOT raw JWTs)
    const url = new URL(redirect, SITE_URL);
    url.searchParams.set("handoff", handoffToken);
    // Also pass access_token as fallback for older web code that checks for it
    url.searchParams.set("access_token", token);
    if (refreshToken) {
      url.searchParams.set("refresh_token", refreshToken);
    }

    console.log(`${tag} handoff-created`, JSON.stringify({
      handoffId: inserted.id,
      userId: maskId(user.id),
      expiresAt,
      selectedCount: selectedItemIds?.length || "all",
      redirect,
    }));

    return jsonResponse({
      ok: true,
      url: url.toString(),
      handoff_id: inserted.id,
      expires_at: expiresAt,
    });
  } catch (err: any) {
    console.error(`${tag} unhandled-error`, err?.message);
    return jsonResponse({
      ok: false,
      error: "INTERNAL_ERROR",
      message: err?.message || "Internal error",
    }, 200);
  }
});
