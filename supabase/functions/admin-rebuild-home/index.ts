import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  buildMobileHomepage,
  buildWebHomepage,
  writeMobileCache,
  writeWebCache,
  loadRefreshSettings,
} from "../_shared/homeRecipeBuilder.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Verify the caller is an admin via user_roles table
 */
async function verifyAdmin(req: Request): Promise<{ ok: boolean; userId?: string }> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return { ok: false };

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  // Decode JWT to get user ID (without verification - Supabase handles that)
  try {
    const payloadB64 = token.split(".")[1];
    const payload = JSON.parse(atob(payloadB64));
    const userId = payload.sub;
    if (!userId) return { ok: false };

    // Check admin role
    const res = await fetch(
      `${supabaseUrl}/rest/v1/user_roles?user_id=eq.${userId}&role=eq.admin&select=id&limit=1`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );
    if (!res.ok) return { ok: false };
    const rows = await res.json();
    return { ok: Array.isArray(rows) && rows.length > 0, userId };
  } catch {
    return { ok: false };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const { ok, userId } = await verifyAdmin(req);
  if (!ok) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  try {
    let target = "mobile";
    let env = "production";
    let recipeKey: string | null = null;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        target = body.target || "mobile";
        env = body.env || "production";
        recipeKey = body.recipeKey || null;
      } catch { /* defaults */ }
    } else {
      const url = new URL(req.url);
      target = url.searchParams.get("target") || "mobile";
      env = url.searchParams.get("env") || "production";
      recipeKey = url.searchParams.get("recipeKey") || null;
    }

    if (target !== "mobile" && target !== "web") {
      return json({ ok: false, error: "target must be 'mobile' or 'web'" }, 400);
    }

    const settings = await loadRefreshSettings(env);
    console.log(`[ADMIN_REBUILD_HOME] target=${target} env=${env} recipeKey=${recipeKey || "all"} userId=${userId}`);

    if (target === "mobile") {
      const result = await buildMobileHomepage(env, recipeKey);
      const ttl = settings.mobile_refresh_hours * 3600;
      await writeMobileCache(env, result.payload, ttl, settings.mobile_schema_version);
      
      // If single-section rebuild, count only rebuilt section items
      let rebuiltItemCount = result.itemCount;
      if (recipeKey && result.payload?.sections) {
        const sections = result.payload.sections as Array<{ key: string; items: unknown[] }>;
        const section = sections.find(s => s.key === recipeKey);
        rebuiltItemCount = section?.items?.length || 0;
      }
      
      return json({
        ok: true,
        target: "mobile",
        env,
        recipeKey: recipeKey || "all",
        itemCount: recipeKey ? rebuiltItemCount : result.itemCount,
        totalItemCount: result.itemCount,
        sectionCount: result.sectionCount,
        durationMs: result.durationMs,
        ttlSeconds: ttl,
        schemaVersion: settings.mobile_schema_version,
      });
    } else {
      const result = await buildWebHomepage(env, recipeKey);
      const ttl = settings.web_refresh_hours * 3600;
      await writeWebCache(env, result.payload, ttl, settings.web_schema_version);
      
      // If single-section rebuild, count only new items for that recipe
      let rebuiltItemCount = result.itemCount;
      if (recipeKey && result.payload?.meta) {
        const meta = result.payload.meta as Record<string, unknown>;
        rebuiltItemCount = (meta.rebuiltSectionItemCount as number) || result.itemCount;
      }
      
      return json({
        ok: true,
        target: "web",
        env,
        recipeKey: recipeKey || "all",
        itemCount: recipeKey ? rebuiltItemCount : result.itemCount,
        totalItemCount: result.itemCount,
        sectionCount: result.sectionCount,
        durationMs: result.durationMs,
        ttlSeconds: ttl,
        schemaVersion: settings.web_schema_version,
      });
    }
  } catch (err) {
    console.error(`[ADMIN_REBUILD_HOME] error: ${err}`);
    return json({ ok: false, error: String(err) }, 500);
  }
});
