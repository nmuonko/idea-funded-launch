/**
 * mobile-checkout-bridge
 * 
 * Returns a pre-authenticated checkout URL that the frozen RN app can open
 * in a WebView.  The URL contains the user's current JWT so the web frontend
 * can bootstrap a Supabase session without relying on WebView localStorage.
 *
 * POST /mobile-checkout-bridge
 * Headers: Authorization / x-auth-token / etc.
 * Body (optional): { redirect?: string }
 * Response: { ok: true, url: "https://…/checkout?access_token=…&refresh_token=…" }
 */

import { corsHeaders, extractRequestToken, verifyAndGetUser, getRequestAuthDiagnostics, buildForwardHeaders, authErrorResponse } from "../_shared/auth.ts";

const SITE_URL = Deno.env.get("SITE_URL") || "https://idea-funded-launch.lovable.app";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const diag = getRequestAuthDiagnostics(req);
  console.log("[checkout-bridge] Request:", JSON.stringify(diag));

  try {
    const { token, source } = await extractRequestToken(req);

    if (!token) {
      return authErrorResponse("NO_TOKEN", "No authentication token found.", corsHeaders);
    }

    let user: any;
    try {
      const result = await verifyAndGetUser(req, undefined, { token, source });
      user = result.user;
    } catch (err: any) {
      const code = err?.message?.includes("expired") ? "EXPIRED_TOKEN" : "INVALID_TOKEN";
      return authErrorResponse(code, err?.message || "Authentication failed.", corsHeaders);
    }

    // Try to get a fresh session (access + refresh tokens)
    // We already have the access token; for the refresh token we check the request body
    let body: any = {};
    try {
      body = await req.json();
    } catch { /* no body is fine */ }

    const redirect = body?.redirect || "/checkout";

    // Build the URL with tokens embedded
    const url = new URL(redirect, SITE_URL);
    url.searchParams.set("access_token", token);
    // If the caller sent a refresh_token, pass it through
    if (body?.refresh_token) {
      url.searchParams.set("refresh_token", body.refresh_token);
    }

    console.log("[checkout-bridge] ✅ Generated URL for user:", user?.email, "redirect:", redirect);

    return new Response(
      JSON.stringify({
        ok: true,
        url: url.toString(),
        user_id: user?.id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("[checkout-bridge] Error:", err?.message);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "Internal error" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
