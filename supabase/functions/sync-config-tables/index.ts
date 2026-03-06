import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-internal-cron-key",
};

const TABLES_TO_SYNC = [
  { name: "catalog_providers", conflict: "id" },
  { name: "home_recipes", conflict: "id" },
  { name: "home_sections", conflict: "key" },
  { name: "admin_settings", conflict: "key" },
  { name: "home_recipe_seeds", conflict: "id" },
  { name: "home_section_seeds", conflict: "id" },
  { name: "catalog_categories", conflict: "slug" },
  { name: "catalog_nav_tabs", conflict: "key" },
  { name: "catalog_nav_subtabs", conflict: "id" },
  { name: "catalog_seed_queries", conflict: "id" },
  { name: "feature_flags", conflict: "key,platform" },
  { name: "catalog_config", conflict: "key" },
  { name: "catalog_filter_profiles", conflict: "key" },
  { name: "catalog_nav_settings", conflict: "key" },
  { name: "catalog_category_ttl", conflict: "category_key" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Auth
    const cronSecret = req.headers.get("x-cron-secret") || req.headers.get("x-internal-cron-key");
    if (cronSecret !== "afrishop-internal-cron-2026") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const localDb = createClient(supabaseUrl, serviceKey);

    // Remote (new) project — use service role key to bypass RLS
    const remoteServiceKey = Deno.env.get("REMOTE_SERVICE_ROLE_KEY") || Deno.env.get("REMOTE_ANON_KEY")!;
    const { data: targetSetting } = await localDb
      .from("admin_settings")
      .select("value")
      .eq("key", "edge_function_base_url")
      .maybeSingle();

    const targetBaseUrl = targetSetting?.value?.trim();
    if (!targetBaseUrl) {
      return new Response(JSON.stringify({ error: "No edge_function_base_url" }), { status: 400, headers: corsHeaders });
    }

    // Extract remote project URL from edge function URL
    const remoteMatch = targetBaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
    if (!remoteMatch) {
      return new Response(JSON.stringify({ error: "Cannot parse remote URL" }), { status: 400, headers: corsHeaders });
    }
    const remoteProjectUrl = `https://${remoteMatch[1]}.supabase.co`;
    
    // We'll use the REST API directly to upsert into the remote DB
    const results: Record<string, unknown> = {};

    for (const table of TABLES_TO_SYNC) {
      try {
        // Read all rows from local
        const { data: rows, error: readErr } = await localDb
          .from(table.name)
          .select("*")
          .limit(1000);

        if (readErr) {
          results[table.name] = { error: `Read: ${readErr.message}`, localCount: 0 };
          continue;
        }

        if (!rows || rows.length === 0) {
          results[table.name] = { skipped: true, reason: "No rows in source" };
          continue;
        }

        // Upsert to remote via REST API
        const upsertUrl = `${remoteProjectUrl}/rest/v1/${table.name}`;
        const resp = await fetch(upsertUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": remoteAnonKey,
            "Authorization": `Bearer ${remoteAnonKey}`,
            "Prefer": `resolution=merge-duplicates`,
          },
          body: JSON.stringify(rows),
        });

        if (!resp.ok) {
          const errText = await resp.text();
          results[table.name] = { error: `Upsert ${resp.status}: ${errText}`, localCount: rows.length };
        } else {
          results[table.name] = { synced: rows.length, status: "ok" };
        }
      } catch (e) {
        results[table.name] = { error: e.message };
      }
    }

    return new Response(JSON.stringify({ success: true, results }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
