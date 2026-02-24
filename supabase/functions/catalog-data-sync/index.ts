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
      const pageSize = parseInt(url.searchParams.get("pageSize") || "1000");
      const maxPage = Math.min(page, 500); // safety cap
      const safePageSize = Math.min(pageSize, 1000); // Supabase caps at 1000 rows per query

      const { data: items, error, count } = await supabase
        .from("catalog_items")
        .select("*", { count: "exact" })
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

      // Batch upsert in chunks of 200, stripping auto-generated fields
      let inserted = 0;
      let skipped = 0;
      let errors = 0;
      const errorDetails: string[] = [];
      const chunkSize = 200;

      for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize);
        // Strip id, created_at, updated_at so destination DB generates its own
        const cleanedChunk = chunk.map((item: Record<string, unknown>) => {
          const { id, created_at, updated_at, ...rest } = item;
          return rest;
        });
        const { data, error: upsertErr } = await supabase
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

      return new Response(JSON.stringify({
        success: true,
        total: items.length,
        inserted,
        skipped,
        errors,
        errorDetails: errorDetails.length > 0 ? errorDetails.slice(0, 10) : undefined,
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
