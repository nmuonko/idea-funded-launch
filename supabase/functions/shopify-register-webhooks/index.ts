// Registers required Shopify webhooks pointing at our shopify-webhooks function.
// Run once after deploy (or anytime topics change).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const SHOP_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN") || Deno.env.get("SHOPIFY_STORE_PERMANENT_DOMAIN")!;
const ADMIN_TOKEN = Deno.env.get("SHOPIFY_ADMIN_ACCESS_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const API_VERSION = "2025-07";

const TOPICS = [
  "products/create",
  "products/update",
  "products/delete",
  "inventory_levels/update",
  "collections/create",
  "collections/update",
  "collections/delete",
];

const projectRef = SUPABASE_URL.replace("https://", "").split(".")[0];
const CALLBACK_URL = `https://${projectRef}.functions.supabase.co/shopify-webhooks`;

async function adminREST(path: string, init: RequestInit = {}) {
  const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ADMIN_TOKEN,
      ...(init.headers || {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function listExisting(): Promise<any[]> {
  const { json } = await adminREST("webhooks.json?limit=250");
  return json.webhooks || [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cronHeader = req.headers.get("x-cron-secret");
  const auth = req.headers.get("authorization") || "";
  const authorized = (CRON_SECRET && cronHeader === CRON_SECRET) || auth.includes(SERVICE_ROLE);
  if (!authorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const results: Record<string, any> = { callback: CALLBACK_URL, registered: [], skipped: [], errors: [] };

  try {
    const existing = await listExisting();
    for (const topic of TOPICS) {
      const already = existing.find((w: any) => w.topic === topic && w.address === CALLBACK_URL);
      if (already) {
        results.skipped.push({ topic, id: already.id });
        continue;
      }
      const { ok, status, json } = await adminREST("webhooks.json", {
        method: "POST",
        body: JSON.stringify({ webhook: { topic, address: CALLBACK_URL, format: "json" } }),
      });
      if (ok) results.registered.push({ topic, id: json?.webhook?.id });
      else results.errors.push({ topic, status, error: json });
    }
    return new Response(JSON.stringify(results), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e), partial: results }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
