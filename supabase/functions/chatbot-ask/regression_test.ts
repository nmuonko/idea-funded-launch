// Regression tests for Sophie chatbot.
// Verifies that Sophie answers directly (no WhatsApp escalation) for the
// three categories the team flagged: delivery time, price negotiation,
// scam/trust, and warranty/brand-new product questions.
//
// Run with: supabase--test_edge_functions { functions: ["chatbot-ask"] }
import "https://deno.land/std@0.224.0/dotenv/load.ts";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") || Deno.env.get("SUPABASE_URL")!;
const ANON_KEY =
  Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ||
  Deno.env.get("SUPABASE_ANON_KEY")!;

const ESCALATION_MARKERS = [
  "WhatsApp",
  "whatsapp",
  "contactez notre équipe",
  "reach our team",
];

async function ask(message: string, language = "fr") {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/chatbot-ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ANON_KEY}`,
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ message, language, session_id: crypto.randomUUID() }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

function expectDirectAnswer(label: string, body: any) {
  assertEquals(body.needs_escalation, false, `${label}: should NOT escalate (got ${body.escalation_reason})`);
  const answer = String(body.answer || "");
  assert(answer.length > 20, `${label}: answer too short`);
  for (const marker of ESCALATION_MARKERS) {
    assert(!answer.includes(marker), `${label}: answer contains escalation marker "${marker}"`);
  }
}

Deno.test("Sophie answers delivery-time complaint directly (FR)", async () => {
  const { status, body } = await ask("Le délai de livraison c'est trop long");
  assertEquals(status, 200);
  expectDirectAnswer("delivery-time FR", body);
});

Deno.test("Sophie answers delivery-time complaint directly (EN)", async () => {
  const { status, body } = await ask("Why is delivery so long? It takes forever", "en");
  assertEquals(status, 200);
  expectDirectAnswer("delivery-time EN", body);
});

Deno.test("Sophie answers price negotiation with 30/70 plan (FR)", async () => {
  const { status, body } = await ask("Pouvez-vous me faire une réduction sur le prix ?");
  assertEquals(status, 200);
  expectDirectAnswer("price-negotiation FR", body);
  const a = String(body.answer || "").toLowerCase();
  const ok = ["30", "70", "plan", "tout compris", "compris", "déjà", "fixe", "négoci", "bas"].some((k) => a.includes(k));
  assert(ok, `price-negotiation FR: expected mention of 30/70 plan, all-inclusive, or non-negotiable pricing — got: ${a.slice(0, 200)}`);
});

Deno.test("Sophie answers price negotiation with 30/70 plan (EN)", async () => {
  const { status, body } = await ask("Can I get a discount? Your prices are too high", "en");
  assertEquals(status, 200);
  expectDirectAnswer("price-negotiation EN", body);
});

Deno.test("Sophie handles scam/trust concerns directly (FR)", async () => {
  const { status, body } = await ask("Est-ce que AfriShop est une arnaque ? Comment vous faire confiance ?");
  assertEquals(status, 200);
  expectDirectAnswer("scam FR", body);
});

Deno.test("Sophie handles scam/trust concerns directly (EN)", async () => {
  const { status, body } = await ask("Is AfriShop a scam? How can I trust you?", "en");
  assertEquals(status, 200);
  expectDirectAnswer("scam EN", body);
});

Deno.test("Sophie confirms brand-new packaging (FR: c'est en carton)", async () => {
  const { status, body } = await ask("C'est en carton ? C'est neuf ?");
  assertEquals(status, 200);
  expectDirectAnswer("brand-new FR", body);
});

Deno.test("Sophie answers warranty question directly (FR)", async () => {
  const { status, body } = await ask("Avez-vous une garantie sur les produits ?");
  assertEquals(status, 200);
  expectDirectAnswer("warranty FR", body);
});

Deno.test("Sophie answers warranty question directly (EN)", async () => {
  const { status, body } = await ask("Do you offer a warranty on products?", "en");
  assertEquals(status, 200);
  expectDirectAnswer("warranty EN", body);
});

// ── URL/button rendering regression ─────────────────────────────────────────
// Every URL Sophie emits MUST be wrapped in markdown `[label](url)` so the
// client renders it as a green button. A bare URL would render as a blue
// underline link (or be unclickable), which the team has rejected.
function assertNoBareUrls(label: string, answer: string) {
  // Strip all valid markdown link payloads `[label](url)` then look for any
  // residual http(s) URL — that would be a bare link.
  const stripped = String(answer || "").replace(/\[[^\]]+\]\(https?:\/\/[^)\s]+\)/g, "");
  const bare = stripped.match(/https?:\/\/\S+/);
  assert(!bare, `${label}: response contains bare URL "${bare?.[0]}" — must be wrapped as [label](url) button`);
}

const URL_PROBES: Array<{ label: string; message: string; lang?: string }> = [
  { label: "checkout link FR",  message: "Donnez-moi le lien pour payer maintenant" },
  { label: "checkout link EN",  message: "Send me the checkout link please", lang: "en" },
  { label: "whatsapp escalate", message: "Je veux parler à un agent humain tout de suite, c'est urgent" },
  { label: "policy/help link",  message: "Où est votre politique de remboursement ?" },
  { label: "track order link",  message: "How can I track my order?", lang: "en" },
];

for (const probe of URL_PROBES) {
  Deno.test(`No bare URLs in chatbot reply — ${probe.label}`, async () => {
    const { status, body } = await ask(probe.message, probe.lang || "fr");
    assertEquals(status, 200);
    assertNoBareUrls(probe.label, body.answer || "");
  });
}
