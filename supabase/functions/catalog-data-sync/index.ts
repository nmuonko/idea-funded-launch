import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // Verify admin auth
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Check admin
    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!adminRole) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") || "export";

    if (mode === "export") {
      // Export ALL items as NDJSON (streamed)
      const page = parseInt(url.searchParams.get("page") || "0");
      const pageSize = parseInt(url.searchParams.get("pageSize") || "5000");
      const maxPage = Math.min(page, 100); // safety cap
      const safePageSize = Math.min(pageSize, 5000);

      const { data: items, error, count } = await supabase
        .from("catalog_items")
        .select("id,provider,provider_product_id,title,brand,price_usd,image_url,product_url,category_key,condition,currency,in_stock,is_active,is_disallowed,rating,tags,unified_category,unified_subcategory,popularity_score,listing_type,buying_options,search_text,images,metadata,data_hash,first_seen_at,last_seen_at,price_updated_at,data_updated_at,last_checked_at,fail_count,parts_subkey,vehicles_subkey", { count: "exact" })
        .order("id")
        .range(maxPage * safePageSize, (maxPage + 1) * safePageSize - 1);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        page: maxPage,
        pageSize: safePageSize,
        total: count ?? 0,
        totalPages: Math.ceil((count ?? 0) / safePageSize),
        itemCount: items?.length ?? 0,
        items: items ?? [],
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (mode === "import") {
      if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "POST required for import" }), {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const body = await req.json();
      const items = body.items;

      if (!Array.isArray(items) || items.length === 0) {
        return new Response(JSON.stringify({ error: "No items provided" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Batch upsert with ON CONFLICT DO NOTHING (in chunks of 500)
      let inserted = 0;
      let skipped = 0;
      let errors = 0;
      const chunkSize = 500;

      for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        const { data, error: upsertErr } = await supabase
          .from("catalog_items")
          .upsert(chunk, {
            onConflict: "provider,provider_product_id",
            ignoreDuplicates: true,
          })
          .select("id");

        if (upsertErr) {
          console.error(`[catalog-data-sync] Chunk ${i / chunkSize} error:`, upsertErr.message);
          errors += chunk.length;
        } else {
          inserted += data?.length ?? 0;
          skipped += chunk.length - (data?.length ?? 0);
        }
      }

      return new Response(JSON.stringify({
        success: true,
        total: items.length,
        inserted,
        skipped,
        errors,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid mode. Use 'export' or 'import'" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[catalog-data-sync] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
