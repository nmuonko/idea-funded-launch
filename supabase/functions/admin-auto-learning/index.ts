import { createClient } from "@supabase/supabase-js";
import { getProviderHealthSummary } from "../_shared/providerHealth.ts";
import { resolveIngestionTarget, buildWorkerHeaders } from "../_shared/ingestionTarget.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function verifyAdmin(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) throw new Error("Unauthorized");

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) throw new Error("Unauthorized");

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  const { data: roleData } = await serviceClient
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (!roleData) throw new Error("Admin access required");

  return { user, serviceClient };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { serviceClient } = await verifyAdmin(req);
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "dashboard";

    // GET actions (read-only)
    if (req.method === "GET") {
      if (action === "dashboard") {
        const { data: popular, error: popErr } = await serviceClient.rpc(
          "get_popular_queries",
          { p_window_hours: 24, p_limit: 50 }
        );
        if (popErr) throw popErr;

        const { count: total24h } = await serviceClient
          .from("search_query_log")
          .select("*", { count: "exact", head: true })
          .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

        const { data: promotions, error: promoErr } = await serviceClient
          .from("auto_seed_promotions")
          .select("*")
          .order("updated_at", { ascending: false })
          .limit(100);
        if (promoErr) throw promoErr;

        const promoted = (promotions || []).filter((p: any) => p.status === "promoted").length;
        const liveHits = (popular || []).reduce((sum: number, q: any) => sum + (Number(q.avg_live) > 0 ? 1 : 0), 0);

        return new Response(
          JSON.stringify({
            popular: popular || [],
            promotions: promotions || [],
            stats: { total24h: total24h || 0, uniqueQueries: (popular || []).length, liveHits, promoted },
            providerHealth: getProviderHealthSummary(),
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ error: "Unknown GET action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST actions (mutations)
    if (req.method === "POST") {
      if (action === "run-promotion") {
        const { data, error } = await serviceClient.rpc("promote_popular_searches", {
          p_min_searches: 3,
          p_window_hours: 24,
          p_auto_enqueue: true,
        });
        if (error) throw error;

        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action === "update-status") {
        const body = await req.json();
        const { id, status } = body;

        if (!id || !status || !["promoted", "rejected", "candidate"].includes(status)) {
          return new Response(JSON.stringify({ error: "Invalid id or status" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        const updateData: any = { status, updated_at: new Date().toISOString() };
        if (status === "promoted") updateData.promoted_at = new Date().toISOString();

        const { error } = await serviceClient
          .from("auto_seed_promotions")
          .update(updateData)
          .eq("id", id);
        if (error) throw error;

        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action === "manual-enqueue") {
        const body = await req.json();
        const { id } = body;
        if (!id) {
          return new Response(JSON.stringify({ error: "Missing id" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Get the promotion record
        const { data: promo, error: fetchErr } = await serviceClient
          .from("auto_seed_promotions")
          .select("*")
          .eq("id", id)
          .single();
        if (fetchErr || !promo) {
          return new Response(JSON.stringify({ error: "Promotion not found" }), {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Force enqueue regardless of avg_result_count
        const { error: enqErr } = await serviceClient
          .from("catalog_refresh_queue")
          .insert({
            category_key: promo.category_key || "general",
            provider: "ebay",
            query: promo.query_normalized,
            priority: 3,
            status: "queued",
            scheduled_at: new Date().toISOString(),
          });

        if (enqErr && !enqErr.message?.includes("duplicate")) throw enqErr;

        await serviceClient
          .from("auto_seed_promotions")
          .update({ status: "promoted", promoted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("id", id);

        return new Response(JSON.stringify({ ok: true, enqueued: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action === "run-seed-backfill") {
        // Trigger the catalog-refresh-worker in seed-backfill mode — route to target
        const { targetBaseUrl } = await resolveIngestionTarget(serviceClient);
        const workerUrl = `${targetBaseUrl}/catalog-refresh-worker`;
        console.log(`[run-seed-backfill] Routing to: ${workerUrl}`);
        const startTime = Date.now();

        const workerRes = await fetch(workerUrl, {
          method: "POST",
          headers: buildWorkerHeaders(),
          body: JSON.stringify({ mode: "seed-backfill" }),
        });

        const workerData = await workerRes.json();
        const durationMs = Date.now() - startTime;

        return new Response(JSON.stringify({
          ok: true,
          ...workerData,
          totalDurationMs: durationMs,
          routed_to: workerUrl,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action === "continue-backfill") {
        // Process existing queued jobs — route to target
        const { targetBaseUrl } = await resolveIngestionTarget(serviceClient);
        const workerUrl = `${targetBaseUrl}/catalog-refresh-worker`;
        console.log(`[continue-backfill] Routing to: ${workerUrl}`);
        const startTime = Date.now();

        const workerRes = await fetch(workerUrl, {
          method: "POST",
          headers: buildWorkerHeaders(),
          body: JSON.stringify({ mode: "queue", maxJobs: 50 }),
        });

        const workerData = await workerRes.json();
        const durationMs = Date.now() - startTime;

        return new Response(JSON.stringify({
          ok: true,
          ...workerData,
          totalDurationMs: durationMs,
          routed_to: workerUrl,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action === "export-seeds") {
        // Export all seed queries as JSON (for cross-environment sync)
        const { data: seeds, error: seedErr } = await serviceClient
          .from("catalog_seed_queries")
          .select("id,category,ebay_category_id,enabled,filters,provider,query,seed_key,ttl_minutes")
          .eq("enabled", true)
          .order("category")
          .limit(1000);
        if (seedErr) throw seedErr;

        return new Response(JSON.stringify({ seeds: seeds || [], count: (seeds || []).length }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action === "generate-seeds-sql") {
        // Generate SQL INSERT statements for cross-environment sync via SQL editor
        const { data: seeds, error: seedErr } = await serviceClient
          .from("catalog_seed_queries")
          .select("id,category,ebay_category_id,enabled,filters,provider,query,seed_key,ttl_minutes")
          .eq("enabled", true)
          .order("category")
          .limit(1000);
        if (seedErr) throw seedErr;

        if (!seeds || seeds.length === 0) {
          return new Response("-- No seeds found\n", {
            headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
          });
        }

        const escSql = (s: string | null) => s ? `'${s.replace(/'/g, "''")}'` : "NULL";
        
        // Build INSERT in batches of 50 for readability
        let sql = "-- Auto-generated seed queries INSERT (" + seeds.length + " rows)\n";
        sql += "-- Run this in the Live SQL editor\n\n";
        
        for (let i = 0; i < seeds.length; i += 50) {
          const batch = seeds.slice(i, i + 50);
          sql += "INSERT INTO catalog_seed_queries (id, category, ebay_category_id, enabled, filters, provider, query, seed_key, ttl_minutes) VALUES\n";
          sql += batch.map((s: any) => {
            const filters = s.filters && Object.keys(s.filters).length > 0 ? escSql(JSON.stringify(s.filters)) : "'{}'::jsonb";
            return `  (${escSql(s.id)}, ${escSql(s.category)}, ${escSql(s.ebay_category_id)}, ${s.enabled}, ${filters}, ${escSql(s.provider)}, ${escSql(s.query)}, ${escSql(s.seed_key)}, ${s.ttl_minutes || 360})`;
          }).join(",\n");
          sql += "\nON CONFLICT (id) DO NOTHING;\n\n";
        }

        return new Response(sql, {
          headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
        });
      }

      if (action === "import-seeds") {
        // Import seed queries from JSON body (for cross-environment sync)
        const body = await req.json();
        const seeds = body.seeds;
        if (!Array.isArray(seeds) || seeds.length === 0) {
          return new Response(JSON.stringify({ error: "Missing or empty seeds array" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Check current count
        const { count: existing } = await serviceClient
          .from("catalog_seed_queries")
          .select("*", { count: "exact", head: true });

        // Upsert in batches of 50
        let inserted = 0;
        let errors = 0;
        for (let i = 0; i < seeds.length; i += 50) {
          const batch = seeds.slice(i, i + 50).map((s: any) => ({
            id: s.id,
            category: s.category,
            ebay_category_id: s.ebay_category_id || null,
            enabled: s.enabled ?? true,
            filters: s.filters || {},
            provider: s.provider || "ebay",
            query: s.query,
            seed_key: s.seed_key,
            ttl_minutes: s.ttl_minutes || 360,
          }));

          const { error: upsertErr } = await serviceClient
            .from("catalog_seed_queries")
            .upsert(batch, { onConflict: "id" });

          if (upsertErr) {
            console.error(`Batch ${i} error:`, upsertErr);
            errors++;
          } else {
            inserted += batch.length;
          }
        }

        return new Response(JSON.stringify({
          ok: true,
          imported: inserted,
          errors,
          existingBefore: existing || 0,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (action === "backfill-status") {
        // Get queue status + category counts for verification
        const { count: queuedCount } = await serviceClient
          .from("catalog_refresh_queue")
          .select("*", { count: "exact", head: true })
          .eq("status", "queued")
          .eq("provider", "ebay");

        const { count: runningCount } = await serviceClient
          .from("catalog_refresh_queue")
          .select("*", { count: "exact", head: true })
          .eq("status", "running")
          .eq("provider", "ebay");

        const { data: categoryCounts } = await serviceClient.rpc("admin_catalog_category_counts");

        return new Response(JSON.stringify({
          queue: { queued: queuedCount || 0, running: runningCount || 0 },
          categories: categoryCounts || [],
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ error: "Unknown POST action" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    const status = err.message === "Unauthorized" ? 401 : err.message === "Admin access required" ? 403 : 500;
    return new Response(
      JSON.stringify({ error: status < 500 ? err.message : "Internal error" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
