import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-internal-cron-key",
};

const TABLES_TO_SYNC = [
  { name: "home_sections", conflict: "key" },
  { name: "home_section_seeds", conflict: "id" },
  { name: "catalog_categories", conflict: "slug" },
  { name: "catalog_nav_tabs", conflict: "key" },
  { name: "catalog_seed_queries", conflict: "id" },
  { name: "feature_flags", conflict: "key,platform" },
  { name: "catalog_filter_profiles", conflict: "key" },
  { name: "catalog_nav_settings", conflict: "key" },
  { name: "catalog_category_ttl", conflict: "category_key" },
  { name: "catalog_providers", conflict: "name" },
  { name: "admin_settings", conflict: "key" },
  { name: "catalog_nav_subtabs", conflict: "key" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const cronSecret = req.headers.get("x-cron-secret") || req.headers.get("x-internal-cron-key");
    if (cronSecret !== "afrishop-internal-cron-2026") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const localDb = createClient(supabaseUrl, serviceKey);

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

    const remoteMatch = targetBaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
    if (!remoteMatch) {
      return new Response(JSON.stringify({ error: "Cannot parse remote URL" }), { status: 400, headers: corsHeaders });
    }
    const remoteProjectUrl = `https://${remoteMatch[1]}.supabase.co`;
    const remoteHeaders = {
      "Content-Type": "application/json",
      "apikey": remoteServiceKey,
      "Authorization": `Bearer ${remoteServiceKey}`,
    };

    const results: Record<string, unknown> = {};

    // Helper: upsert rows to remote
    async function upsertRemote(tableName: string, conflict: string, rows: unknown[]) {
      const url = `${remoteProjectUrl}/rest/v1/${tableName}?on_conflict=${conflict}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { ...remoteHeaders, "Prefer": "resolution=merge-duplicates" },
        body: JSON.stringify(rows),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        return { error: `Upsert ${resp.status}: ${errText}`, localCount: rows.length };
      }
      return { synced: rows.length, status: "ok" };
    }

    // Helper: delete all rows from remote table
    async function deleteRemote(tableName: string) {
      // Delete all rows using a filter that matches everything
      const url = `${remoteProjectUrl}/rest/v1/${tableName}?id=not.is.null`;
      const resp = await fetch(url, {
        method: "DELETE",
        headers: remoteHeaders,
      });
      return resp.ok;
    }

    // 1. Sync normal tables
    for (const table of TABLES_TO_SYNC) {
      try {
        const { data: rows, error: readErr } = await localDb
          .from(table.name)
          .select("*")
          .limit(1000);

        if (readErr) {
          results[table.name] = { error: `Read: ${readErr.message}` };
          continue;
        }
        if (!rows || rows.length === 0) {
          results[table.name] = { skipped: true, reason: "No rows in source" };
          continue;
        }
        results[table.name] = await upsertRemote(table.name, table.conflict, rows);
      } catch (e) {
        results[table.name] = { error: e.message };
      }
    }

    // 2. Handle home_recipes + home_recipe_seeds (FK dependency)
    try {
      // Delete seeds first (child), then delete recipes (parent)
      await deleteRemote("home_recipe_seeds");
      await deleteRemote("home_recipes");

      // Read and insert recipes
      const { data: recipes } = await localDb.from("home_recipes").select("*").limit(1000);
      if (recipes && recipes.length > 0) {
        const url = `${remoteProjectUrl}/rest/v1/home_recipes`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { ...remoteHeaders, "Prefer": "return=minimal" },
          body: JSON.stringify(recipes),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          results["home_recipes"] = { error: `Insert ${resp.status}: ${errText}`, localCount: recipes.length };
        } else {
          results["home_recipes"] = { synced: recipes.length, status: "ok" };
        }
      }

      // Then insert seeds
      const { data: seeds } = await localDb.from("home_recipe_seeds").select("*").limit(1000);
      if (seeds && seeds.length > 0) {
        const url = `${remoteProjectUrl}/rest/v1/home_recipe_seeds`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { ...remoteHeaders, "Prefer": "return=minimal" },
          body: JSON.stringify(seeds),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          results["home_recipe_seeds"] = { error: `Insert ${resp.status}: ${errText}`, localCount: seeds.length };
        } else {
          results["home_recipe_seeds"] = { synced: seeds.length, status: "ok" };
        }
      }
    } catch (e) {
      results["home_recipes_group"] = { error: e.message };
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
