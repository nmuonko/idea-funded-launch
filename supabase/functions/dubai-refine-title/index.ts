// dubai-refine-title — token-gated AI cleanup of typed phone names.
import { createClient } from "@supabase/supabase-js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-dubai-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return ok({ ok: false, error: "method_not_allowed" });

  try {
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const SHARED_TOKEN = "DUBAI-AFRISHOP-2026";
    const token = req.headers.get("x-dubai-token") || "";
    let valid = token === SHARED_TOKEN;
    if (!valid) {
      const { data: settingRow } = await supa
        .from("app_secrets")
        .select("value")
        .eq("key", "dubai_upload_token")
        .maybeSingle();
      const storedHash = (settingRow?.value as any)?.hash as string | undefined;
      valid = !!storedHash && (await sha256(token)) === storedHash;
    }
    if (!valid) return ok({ ok: false, error: "invalid_token" });

    const { text } = (await req.json().catch(() => ({}))) as { text?: string };
    const raw = String(text || "").trim().slice(0, 200);
    if (!raw) return ok({ ok: false, error: "text_required" });

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return ok({ ok: true, title: raw }); // graceful fallback

    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "You clean phone product names into clean marketplace titles. Output only the title text, no quotes, no commentary. Capitalize brand and model correctly (iPhone, Samsung, Pixel). Format storage as e.g. 256GB. Include color if present. Always append ' - Dubai Deal' at the end.",
          },
          { role: "user", content: raw },
        ],
        temperature: 0.2,
        max_tokens: 60,
      }),
    });
    if (!r.ok) return ok({ ok: true, title: raw });
    const j = await r.json();
    const title = String(j?.choices?.[0]?.message?.content || raw).trim().slice(0, 160);
    return ok({ ok: true, title });
  } catch (e) {
    console.error("[dubai-refine-title]", e);
    return ok({ ok: false, error: "unexpected" });
  }
});
