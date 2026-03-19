/**
 * auth-me — Mobile compatibility shim
 * 
 * The frozen mobile app calls GET /functions/v1/auth-me at startup.
 * This function didn't exist, causing 401/404 which cascaded into
 * "Backend connection failed" → all warnings shown.
 * 
 * Contract:
 * - GET with Bearer token → returns user profile
 * - GET without token → returns { ok: true, authenticated: false } (HTTP 200)
 * - NEVER returns non-200 to prevent mobile app crash
 */

import { createClient } from "@supabase/supabase-js";
import { buildCorsHeaders, corsPreflightResponse, logStartupRequest } from "../_shared/mobileCors.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return corsPreflightResponse(req);
  }

  const corsHeaders = buildCorsHeaders(req);
  const rid = logStartupRequest("AUTH_ME", req);

  function jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
    });
  }

  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    // No token → unauthenticated but OK
    if (!token || token.length < 10) {
      console.log(`[auth-me] rid=${rid} no valid token, returning unauthenticated`);
      return jsonResponse({
        ok: true,
        authenticated: false,
        user: null,
        profile: null,
        env: "production",
      });
    }

    // Validate token via Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      console.log(`[auth-me] rid=${rid} invalid token: ${userError?.message || "no user"}`);
      return jsonResponse({
        ok: true,
        authenticated: false,
        user: null,
        profile: null,
        env: "production",
        reason: "invalid_token",
      });
    }

    // Fetch profile if exists
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    console.log(`[auth-me] rid=${rid} authenticated user=${user.id} email=${user.email}`);

    return jsonResponse({
      ok: true,
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone || null,
        created_at: user.created_at,
        email_confirmed_at: user.email_confirmed_at,
        last_sign_in_at: user.last_sign_in_at,
      },
      profile: profile || null,
      env: "production",
    });

  } catch (err: any) {
    console.error(`[auth-me] rid=${rid} unexpected error:`, err);
    // NEVER return non-200
    return jsonResponse({
      ok: true,
      authenticated: false,
      user: null,
      profile: null,
      env: "production",
      error: err.message,
    });
  }
});
