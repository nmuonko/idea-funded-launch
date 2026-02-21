import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getProviderHealthSummary } from "../_shared/providerHealth.ts";

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
        // Trigger the catalog-refresh-worker in seed-backfill mode
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        const workerUrl = `${supabaseUrl}/functions/v1/catalog-refresh-worker`;
        const startTime = Date.now();

        const workerRes = await fetch(workerUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({ mode: "seed-backfill" }),
        });

        const workerData = await workerRes.json();
        const durationMs = Date.now() - startTime;

        return new Response(JSON.stringify({
          ok: true,
          ...workerData,
          totalDurationMs: durationMs,
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
