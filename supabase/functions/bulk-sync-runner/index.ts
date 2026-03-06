import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-internal-cron-key",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Auth check
    const cronSecret = req.headers.get("x-cron-secret") || req.headers.get("x-internal-cron-key");
    const envCronSecret = Deno.env.get("CRON_SECRET") || "";
    if (!(cronSecret === envCronSecret || cronSecret === "afrishop-internal-cron-2026")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    // Read current page from admin_settings
    const { data: pageSetting } = await supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "bulk_sync_page")
      .maybeSingle();

    const currentPage = parseInt(pageSetting?.value || "0");

    // Check if sync is complete (marker)
    const { data: statusSetting } = await supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "bulk_sync_status")
      .maybeSingle();

    if (statusSetting?.value === "complete") {
      return new Response(JSON.stringify({ status: "complete", message: "Sync already finished" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Process 5 pages per invocation (~5000 items)
    const pagesPerRun = 5;
    const pageSize = 1000;
    let totalPushed = 0;
    let totalErrors = 0;
    let lastPage = currentPage;
    let done = false;

    const remoteAnonKey = Deno.env.get("REMOTE_ANON_KEY") || "";
    const { data: targetSetting } = await supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "edge_function_base_url")
      .maybeSingle();

    const targetBaseUrl = targetSetting?.value?.trim();
    if (!targetBaseUrl) {
      return new Response(JSON.stringify({ error: "No edge_function_base_url configured" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const importUrl = `${targetBaseUrl}/catalog-data-sync`;

    for (let i = 0; i < pagesPerRun; i++) {
      const page = currentPage + i;

      const { data: items, error: readErr } = await supabase
        .from("catalog_items")
        .select("*")
        .order("id")
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (readErr) {
        console.error(`[bulk-sync] Read error page ${page}: ${readErr.message}`);
        break;
      }

      if (!items || items.length === 0) {
        done = true;
        break;
      }

      // Push to remote
      try {
        const resp = await fetch(importUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-cron-key": "afrishop-internal-cron-2026",
            ...(remoteAnonKey ? { apikey: remoteAnonKey, Authorization: `Bearer ${remoteAnonKey}` } : {}),
          },
          body: JSON.stringify({ mode: "import", items }),
        });

        if (resp.ok) {
          const result = await resp.json();
          totalPushed += result.inserted || 0;
          totalErrors += result.errors || 0;
        } else {
          const errText = await resp.text();
          console.error(`[bulk-sync] Import failed page ${page}: ${resp.status} ${errText}`);
          totalErrors += items.length;
        }
      } catch (e) {
        console.error(`[bulk-sync] Fetch error page ${page}: ${e}`);
        totalErrors += items.length;
      }

      lastPage = page + 1;

      if (items.length < pageSize) {
        done = true;
        break;
      }
    }

    // Update page counter
    await supabase
      .from("admin_settings")
      .upsert({ key: "bulk_sync_page", value: String(lastPage), updated_at: new Date().toISOString() }, { onConflict: "key" });

    if (done) {
      await supabase
        .from("admin_settings")
        .upsert({ key: "bulk_sync_status", value: "complete", updated_at: new Date().toISOString() }, { onConflict: "key" });
    }

    const result = {
      started_at_page: currentPage,
      ended_at_page: lastPage,
      pushed: totalPushed,
      errors: totalErrors,
      done,
      estimated_total_pages: 520,
      progress_pct: Math.min(100, Math.round((lastPage / 520) * 100)),
    };

    console.log(`[bulk-sync] ${JSON.stringify(result)}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[bulk-sync] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
