import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  buildMobileHomepage,
  buildWebHomepage,
  readMobileCache,
  readWebCache,
  writeMobileCache,
  writeWebCache,
  loadRefreshSettings,
} from "../_shared/homeRecipeBuilder.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // Auth: require internal cron key or service_role
  const cronKey = req.headers.get("x-internal-cron-key") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const envCronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const isCron = !!envCronSecret && cronKey === envCronSecret;
  const isServiceRole = !!serviceKey && authHeader === `Bearer ${serviceKey}`;
  if (!isCron && !isServiceRole) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const env = "production";
  const results: Record<string, unknown> = { env, ts: Date.now() };

  try {
    const settings = await loadRefreshSettings(env);
    console.log(`[HOME_AUTO_REFRESH] checking staleness for env=${env}`);

    // Auto-refresh is disabled — admin controls homepage manually via "Publish All"
    if (settings.mobile_refresh_hours <= 0 && settings.web_refresh_hours <= 0) {
      console.log(`[HOME_AUTO_REFRESH] auto-refresh disabled (hours=0), skipping`);
      return json({ ok: true, env, ts: Date.now(), skipped: true, reason: "auto_refresh_disabled" });
    }

    // Check mobile
    if (settings.mobile_refresh_hours > 0) {
      const mobileCache = await readMobileCache(env);
      const mobileTtl = settings.mobile_refresh_hours * 3600;

      if (!mobileCache.hit) {
        console.log(`[HOME_AUTO_REFRESH] mobile cache stale/missing, rebuilding...`);
        const result = await buildMobileHomepage(env);
        await writeMobileCache(env, result.payload, mobileTtl, settings.mobile_schema_version);
        results.mobile = { rebuilt: true, items: result.itemCount, sections: result.sectionCount, durationMs: result.durationMs };
      } else {
        results.mobile = { rebuilt: false, ageSeconds: mobileCache.ageSeconds, ttlSeconds: mobileTtl };
      }
    } else {
      results.mobile = { rebuilt: false, reason: "disabled" };
    }

    // Check web
    if (settings.web_refresh_hours > 0) {
      const webCache = await readWebCache(env);
      const webTtl = settings.web_refresh_hours * 3600;

      if (!webCache.hit) {
        console.log(`[HOME_AUTO_REFRESH] web cache stale/missing, rebuilding...`);
        const result = await buildWebHomepage(env);
        await writeWebCache(env, result.payload, webTtl, settings.web_schema_version);
        results.web = { rebuilt: true, items: result.itemCount, pages: result.sectionCount, durationMs: result.durationMs };
      } else {
        results.web = { rebuilt: false, ageSeconds: webCache.ageSeconds, ttlSeconds: webTtl };
      }
    } else {
      results.web = { rebuilt: false, reason: "disabled" };
    }

    return json({ ok: true, ...results });
  } catch (err) {
    console.error(`[HOME_AUTO_REFRESH] error: ${err}`);
    return json({ ok: false, error: String(err), ...results }, 500);
  }
});
