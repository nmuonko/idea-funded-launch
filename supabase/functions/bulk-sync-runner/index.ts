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

    const cronSecret = req.headers.get("x-cron-secret") || req.headers.get("x-internal-cron-key");
    if (!(cronSecret === "afrishop-internal-cron-2026")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    // Check status
    const { data: statusSetting } = await supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "bulk_sync_status")
      .maybeSingle();

    if (statusSetting?.value === "complete") {
      return new Response(JSON.stringify({ status: "complete" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Read current page
    const { data: pageSetting } = await supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "bulk_sync_page")
      .maybeSingle();

    const currentPage = parseInt(pageSetting?.value || "0");

    // Remote config
    const remoteServiceKey = Deno.env.get("REMOTE_SERVICE_ROLE_KEY")!;
    const { data: targetSetting } = await supabase
      .from("admin_settings")
      .select("value")
      .eq("key", "edge_function_base_url")
      .maybeSingle();

    const targetBaseUrl = targetSetting?.value?.trim();
    if (!targetBaseUrl || !remoteServiceKey) {
      return new Response(JSON.stringify({ error: "Missing remote config" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const remoteMatch = targetBaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
    if (!remoteMatch) {
      return new Response(JSON.stringify({ error: "Cannot parse remote URL" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const remoteProjectUrl = `https://${remoteMatch[1]}.supabase.co`;

    // Process pages — upsert directly via REST API with service role key
    const pagesPerRun = 5;
    const pageSize = 1000;
    let totalPushed = 0;
    let totalErrors = 0;
    let lastPage = currentPage;
    let done = false;

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

      // Upsert directly to remote DB via REST API
      const upsertUrl = `${remoteProjectUrl}/rest/v1/catalog_items?on_conflict=provider,provider_product_id`;
      const resp = await fetch(upsertUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": remoteServiceKey,
          "Authorization": `Bearer ${remoteServiceKey}`,
          "Prefer": "resolution=merge-duplicates",
        },
        body: JSON.stringify(items),
      });

      if (resp.ok) {
        totalPushed += items.length;
      } else {
        const errText = await resp.text();
        console.error(`[bulk-sync] Upsert failed page ${page}: ${resp.status} ${errText}`);
        totalErrors += items.length;
      }

      lastPage = page + 1;

      if (items.length < pageSize) {
        done = true;
        break;
      }
    }

    // Update progress
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
