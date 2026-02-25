import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveIngestionTarget, buildCronHeaders } from "../_shared/ingestionTarget.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-internal-cron-key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── Auth: admin JWT OR cron secret ──────────────────────────────
    const authHeader = req.headers.get("authorization");
    const cronSecret = req.headers.get("x-cron-secret") || req.headers.get("x-internal-cron-key");
    const envCronSecret = Deno.env.get("CRON_SECRET") || "";
    const hardcodedCron = "afrishop-internal-cron-2026";

    let isAuthed = false;
    if (cronSecret && (cronSecret === envCronSecret || cronSecret === hardcodedCron)) {
      isAuthed = true;
    } else if (authHeader) {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (!authErr && user) {
        const { data: adminRole } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .maybeSingle();
        if (adminRole) isAuthed = true;
      }
    }

    if (!isAuthed) {
      return jsonRes({ error: "Unauthorized" }, 401);
    }

    const body = req.method === "POST" ? await req.json() : {};
    const mode = body.mode || "export";

    // ═══════════════════════════════════════════════════════════════════
    // MODE: export  –  paginated read from own DB
    // ═══════════════════════════════════════════════════════════════════
    if (mode === "export") {
      const page = Math.min(parseInt(String(body.page ?? 0)), 500);
      const pageSize = Math.min(parseInt(String(body.pageSize ?? 1000)), 1000);

      const { data: items, error } = await supabase
        .from("catalog_items")
        .select("*")
        .order("id")
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) return jsonRes({ error: error.message }, 500);

      return jsonRes({
        page,
        pageSize,
        itemCount: items?.length ?? 0,
        items: items ?? [],
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // MODE: import  –  upsert items into own DB
    // ═══════════════════════════════════════════════════════════════════
    if (mode === "import") {
      const items = body.items;
      if (!Array.isArray(items) || items.length === 0) {
        return jsonRes({ error: "No items provided" }, 400);
      }

      const liveClient = supabase;
      let inserted = 0;
      let skipped = 0;
      let errors = 0;
      const errorDetails: string[] = [];
      const chunkSize = 200;

      for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        const cleanedChunk = chunk.map((item: Record<string, unknown>) => {
          const { id, created_at, updated_at, ...rest } = item;
          return rest;
        });
        const { data, error: upsertErr } = await liveClient
          .from("catalog_items")
          .upsert(cleanedChunk, {
            onConflict: "provider,provider_product_id",
            ignoreDuplicates: true,
          })
          .select("id");

        if (upsertErr) {
          const msg = `Chunk ${Math.floor(i / chunkSize)}: ${upsertErr.message}`;
          console.error(`[catalog-data-sync] ${msg}`);
          errors += chunk.length;
          errorDetails.push(msg);
        } else {
          inserted += data?.length ?? 0;
          skipped += chunk.length - (data?.length ?? 0);
        }
      }

      return jsonRes({
        success: true,
        total: items.length,
        inserted,
        skipped,
        errors,
        errorDetails: errorDetails.length > 0 ? errorDetails.slice(0, 10) : undefined,
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // MODE: push-page  –  read ONE page from own DB → push to Live
    // ═══════════════════════════════════════════════════════════════════
    if (mode === "push-page") {
      const page = parseInt(String(body.page ?? 0));
      const pageSize = Math.min(parseInt(String(body.pageSize ?? 1000)), 1000);

      const { targetBaseUrl, isRemoteTarget } = await resolveIngestionTarget(supabase);

      if (!isRemoteTarget) {
        return jsonRes({ error: "Ingestion target points to the same environment. Set edge_function_base_url to Live." }, 400);
      }

      const liveImportUrl = `${targetBaseUrl}/catalog-data-sync`;

      // Read one page from local DB
      const { data: items, error: readErr } = await supabase
        .from("catalog_items")
        .select("*")
        .order("id")
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (readErr) {
        return jsonRes({ error: `Read error page ${page}: ${readErr.message}` }, 500);
      }

      const batch = items ?? [];
      if (batch.length === 0) {
        return jsonRes({ success: true, page, read: 0, pushed: 0, skipped: 0, errors: 0, done: true });
      }

      // Push in sub-chunks to Live
      const importChunkSize = 500;
      let totalPushed = 0;
      let totalSkipped = 0;
      let totalErrors = 0;

      for (let i = 0; i < batch.length; i += importChunkSize) {
        const chunk = batch.slice(i, i + importChunkSize);
        try {
          const resp = await fetch(liveImportUrl, {
            method: "POST",
            headers: buildCronHeaders(),
            body: JSON.stringify({ mode: "import", items: chunk }),
          });

          if (!resp.ok) {
            const errText = await resp.text();
            console.error(`[push-page] Import failed (${resp.status}): ${errText}`);
            totalErrors += chunk.length;
          } else {
            const result = await resp.json();
            totalPushed += result.inserted || 0;
            totalSkipped += result.skipped || 0;
            totalErrors += result.errors || 0;
          }
        } catch (fetchErr) {
          console.error(`[push-page] Fetch error: ${fetchErr}`);
          totalErrors += chunk.length;
        }
      }

      const hasMore = batch.length === pageSize;

      return jsonRes({
        success: true,
        page,
        read: batch.length,
        pushed: totalPushed,
        skipped: totalSkipped,
        errors: totalErrors,
        done: !hasMore,
        routed_to: liveImportUrl,
      });
    }

    // ═══════════════════════════════════════════════════════════════════
    // MODE: push-to-live (legacy compat — single long request)
    // ═══════════════════════════════════════════════════════════════════
    if (mode === "push-to-live") {
      const { targetBaseUrl, isRemoteTarget } = await resolveIngestionTarget(supabase);

      if (!isRemoteTarget) {
        return jsonRes({ error: "Ingestion target points to the same environment. Configure edge_function_base_url to point to Live." }, 400);
      }

      const liveImportUrl = `${targetBaseUrl}/catalog-data-sync`;
      const importChunkSize = 500;
      const readPageSize = 1000;
      let page = 0;
      let totalRead = 0;
      let totalPushed = 0;
      let totalSkipped = 0;
      let totalErrors = 0;
      let keepGoing = true;
      const startedAt = Date.now();

      console.log(`[push-to-live] Starting bulk sync to ${targetBaseUrl}`);

      while (keepGoing) {
        const { data: items, error: readErr } = await supabase
          .from("catalog_items")
          .select("*")
          .order("id")
          .range(page * readPageSize, (page + 1) * readPageSize - 1);

        if (readErr) {
          console.error(`[push-to-live] Read error page ${page}: ${readErr.message}`);
          break;
        }

        const batch = items ?? [];
        totalRead += batch.length;
        keepGoing = batch.length === readPageSize;

        if (batch.length === 0) break;

        for (let i = 0; i < batch.length; i += importChunkSize) {
          const chunk = batch.slice(i, i + importChunkSize);
          try {
            const resp = await fetch(liveImportUrl, {
              method: "POST",
              headers: buildCronHeaders(),
              body: JSON.stringify({ mode: "import", items: chunk }),
            });

            if (!resp.ok) {
              const errText = await resp.text();
              console.error(`[push-to-live] Import failed (${resp.status}): ${errText}`);
              totalErrors += chunk.length;
            } else {
              const result = await resp.json();
              totalPushed += result.inserted || 0;
              totalSkipped += result.skipped || 0;
              totalErrors += result.errors || 0;
            }
          } catch (fetchErr) {
            console.error(`[push-to-live] Fetch error: ${fetchErr}`);
            totalErrors += chunk.length;
          }
        }

        page++;

        if (page % 10 === 0) {
          console.log(`[push-to-live] Progress: page=${page}, read=${totalRead}, pushed=${totalPushed}, skipped=${totalSkipped}, errors=${totalErrors}`);
        }
      }

      const durationMs = Date.now() - startedAt;
      console.log(`[push-to-live] Complete: read=${totalRead}, pushed=${totalPushed}, skipped=${totalSkipped}, errors=${totalErrors}, duration=${durationMs}ms`);

      return jsonRes({
        success: true,
        mode: "push-to-live",
        total_read: totalRead,
        pushed: totalPushed,
        skipped: totalSkipped,
        errors: totalErrors,
        pages_read: page,
        duration_ms: durationMs,
      });
    }

    return jsonRes({ error: "Invalid mode. Use 'export', 'import', 'push-page', or 'push-to-live'" }, 400);
  } catch (err) {
    console.error("[catalog-data-sync] Error:", err);
    return jsonRes({ error: err.message }, 500);
  }
});
