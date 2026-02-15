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

  try {
    const payloadB64 = token.split(".")[1];
    const payload = JSON.parse(atob(payloadB64));
    const userId = payload.sub;
    if (!userId) return { ok: false };

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

// ─── SEED SYNC ────────────────────────────────────────────────────────────────

interface SeedPayload {
  id: string;
  recipe_id: string;
  query: string;
  weight: number;
  enabled: boolean;
  sort_order: number;
  max_items: number;
  required_terms: string[];
  excluded_terms: string[];
}

/**
 * Upsert seeds into the database so Live always matches what admin configured.
 * This syncs Test seed data to whichever DB this edge function runs on (Live after publish).
 */
async function syncSeeds(seeds: SeedPayload[], recipeId?: string): Promise<number> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const headers = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    Prefer: "resolution=merge-duplicates",
  };

  if (!seeds || seeds.length === 0) return 0;

  // If we have a recipeId, delete existing seeds for that recipe first
  // then insert the new ones - this ensures removed seeds are also removed on Live
  if (recipeId) {
    await fetch(
      `${supabaseUrl}/rest/v1/home_recipe_seeds?recipe_id=eq.${recipeId}`,
      { method: "DELETE", headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` } }
    );
  }

  // Insert all seeds (using upsert on id)
  const payload = seeds.map(s => ({
    id: s.id,
    recipe_id: s.recipe_id,
    query: s.query,
    weight: s.weight,
    enabled: s.enabled,
    sort_order: s.sort_order,
    max_items: s.max_items || 3,
    required_terms: s.required_terms || [],
    excluded_terms: s.excluded_terms || [],
  }));

  const res = await fetch(
    `${supabaseUrl}/rest/v1/home_recipe_seeds`,
    {
      method: "POST",
      headers: { ...headers, Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error(`[ADMIN_REBUILD_HOME] seed sync error: ${err}`);
  }

  return seeds.length;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

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
    let seeds: SeedPayload[] | null = null;

    if (req.method === "POST") {
      try {
        const body = await req.json();
        target = body.target || "mobile";
        env = body.env || "production";
        recipeKey = body.recipeKey || null;
        seeds = body.seeds || null;
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

    // Sync seeds to this database before rebuilding
    let seedsSynced = 0;
    if (seeds && seeds.length > 0) {
      const recipeId = seeds[0]?.recipe_id || null;
      seedsSynced = await syncSeeds(seeds, recipeId || undefined);
      console.log(`[ADMIN_REBUILD_HOME] synced ${seedsSynced} seeds for recipe=${recipeId || "mixed"}`);
    }

    const settings = await loadRefreshSettings(env);
    console.log(`[ADMIN_REBUILD_HOME] target=${target} env=${env} recipeKey=${recipeKey || "all"} userId=${userId} seedsSynced=${seedsSynced}`);

    if (target === "mobile") {
      const result = await buildMobileHomepage(env, recipeKey);
      const ttl = settings.mobile_refresh_hours * 3600;
      await writeMobileCache(env, result.payload, ttl, settings.mobile_schema_version);
      
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
        seedsSynced,
      });
    } else {
      const result = await buildWebHomepage(env, recipeKey);
      const ttl = settings.web_refresh_hours * 3600;
      await writeWebCache(env, result.payload, ttl, settings.web_schema_version);
      
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
        seedsSynced,
      });
    }
  } catch (err) {
    console.error(`[ADMIN_REBUILD_HOME] error: ${err}`);
    return json({ ok: false, error: String(err) }, 500);
  }
});
