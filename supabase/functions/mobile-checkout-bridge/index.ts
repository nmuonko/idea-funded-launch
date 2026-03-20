/**
 * mobile-checkout-bridge
 *
 * AGREED CONTRACT (Lovable ↔ Replit):
 *
 * ── Request ──
 * POST /mobile-checkout-bridge
 * Headers: Authorization / x-auth-token / x-device-id / etc.
 * Body (all fields optional):
 *   {
 *     cart_id?:            string,   // Replit sends this (current cart/order id)
 *     order_id?:           string,   // Replit sends this (if order already created)
 *     selected_item_ids?:  string[], // specific cart item ids to checkout
 *     redirect?:           string,   // web path, default "/checkout"
 *     device_id?:          string,   // also read from x-device-id header
 *     refresh_token?:      string,   // RN refresh token for session bootstrap
 *   }
 *
 * ── Success Response (200) ──
 *   {
 *     ok:          true,
 *     url:         string,   // full checkout URL with ?handoff=...&access_token=...
 *     handoff_id:  string,   // DB id of the handoff token row
 *     expires_at:  string,   // ISO timestamp
 *   }
 *
 * ── Error Response (200) ──
 *   {
 *     ok:         false,
 *     error:      string,       // machine code: NO_TOKEN | INVALID_TOKEN | EXPIRED_TOKEN | EMPTY_CART | INTERNAL_ERROR
 *     error_code: string,       // same as error
 *     message:    string,       // human-readable
 *     authenticated?: false,    // present on auth failures
 *   }
 *
 * ── Flow ──
 * RN taps "Payez maintenant"
 *   → RN calls POST /mobile-checkout-bridge
 *   → backend returns { ok: true, url: "https://…/checkout?handoff=TOKEN&access_token=JWT" }
 *   → RN opens ONLY this url in WebView (not the old bank transfer URL)
 *   → web useTokenFromUrl detects ?handoff, calls checkout-handoff-validate
 *   → web bootstraps session from access_token, ShopProtectedRoute grants access
 *   → checkout page loads
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

function maskId(id: string | null | undefined): string {
  if (!id || id.length < 8) return "***";
  return id.slice(0, 4) + "…" + id.slice(-4);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const tag = "[mobile-checkout-bridge]";

  try {
    // ── Step 1: Auth ──
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
      console.log(`${tag} auth-fail ${code}`);
      return authErrorResponse(code, err?.message || "Authentication failed.");
    }

    console.log(`${tag} auth-ok userId=${maskId(user.id)} source=${source}`);

    // ── Step 2: Parse body (all fields optional) ──
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      /* empty body is fine */
    }

    const cartId = body?.cart_id || null;
    const orderId = body?.order_id || null;
    const selectedItemIds = body?.selected_item_ids || null;
    const redirect = body?.redirect || "/checkout";
    const deviceId = body?.device_id || req.headers.get("x-device-id") || null;
    const refreshToken = body?.refresh_token || null;

    console.log(`${tag} body-parsed`, JSON.stringify({
      cartId: maskId(cartId),
      orderId: maskId(orderId),
      selectedCount: selectedItemIds?.length ?? "all",
      redirect,
      hasDeviceId: !!deviceId,
      hasRefreshToken: !!refreshToken,
    }));

    // ── Step 3: Validate cart exists ──
    const admin = createAdminClient();
    const { data: cartItems } = await admin
      .from("cart_items")
      .select("id")
      .eq("user_id", user.id)
      .limit(1);

    if (!cartItems || cartItems.length === 0) {
      console.log(`${tag} EMPTY_CART userId=${maskId(user.id)}`);
      return jsonResponse({
        ok: false,
        error: "EMPTY_CART",
        error_code: "EMPTY_CART",
        message: "Your cart is empty.",
      }, 200);
    }

    // ── Step 4: Create handoff token ──
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
        error_code: "INTERNAL_ERROR",
        message: "Failed to create handoff token.",
      }, 200);
    }

    // ── Step 5: Build checkout URL ──
    const url = new URL(redirect, SITE_URL);
    url.searchParams.set("handoff", handoffToken);
    url.searchParams.set("access_token", token);
    if (refreshToken) {
      url.searchParams.set("refresh_token", refreshToken);
    }

    console.log(`${tag} handoff-created`, JSON.stringify({
      handoffId: inserted.id,
      userId: maskId(user.id),
      expiresAt,
      url: url.pathname + "?handoff=…",
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
      error_code: "INTERNAL_ERROR",
      message: err?.message || "Internal error",
    }, 200);
  }
});
