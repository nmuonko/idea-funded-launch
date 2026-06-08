// AfriShop AI Chatbot — RAG over faq_kb + AfriShop business context.
// Returns: { answer, classification, needs_escalation, escalation_reason, confidence, conversation_id }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

const BUSINESS_CONTEXT_FR = `
AfriShop (American Goodwill SARL, RDC) aide les clients en RDC à acheter des produits depuis les USA et à les recevoir au Congo.

Modèle:
- Le client parcourt les produits, clique sur "Payer", saisit ses infos (nom, email, adresse), choisit Mobile Money (PawaPay) ou carte bancaire (Stripe), puis confirme le paiement.
- Dès le paiement confirmé, AfriShop lance la commande USA → RDC.
- Délai de livraison typique: 10 à 17 jours selon la ville.
- Prix affichés en USD; total également affiché en CDF au checkout (taux configurable, ~2800 CDF / USD).
- Paiement en 1 fois OU plan acompte 30% / solde 70% à l'arrivée (selon éligibilité).
- Produits interdits: livres, contenu numérique, abonnements, articles adultes/NSFW.
- Statuts commande: DRAFT, PENDING_PAYMENT, PAID, PROCESSING, SHIPPED, COMPLETED.
- Programme parrainage: 10% commission via mobile money après seuil de 5 USD.
- Véhicules: marges décroissantes (70% sous 5000$, jusqu'à 28% à 25000$+). Si données précises manquantes, NE PAS deviner — escalader.

⚠️ Important: AfriShop n'utilise PAS MaishaPay. Uniquement Stripe (carte) et PawaPay (Mobile Money).

Tu es l'assistant AfriShop. Réponds toujours en français court, clair et amical. Guide les clients vers le bouton "Payer" quand ils sont prêts. N'invente JAMAIS d'information. Si tu ne sais pas, escalade.
`.trim();

interface ProductContext {
  id?: string;
  title?: string;
  price_usd?: number;
  price_cdf?: number;
  image?: string;
  link?: string;
  category?: string;
}

async function fetchKb(supabase: any, language: string) {
  const { data } = await supabase
    .from("faq_kb")
    .select("question,answer")
    .eq("is_active", true)
    .eq("language", language)
    .order("priority", { ascending: false })
    .limit(30);
  return (data || []) as { question: string; answer: string }[];
}

function buildKbBlock(kb: { question: string; answer: string }[]) {
  if (!kb.length) return "(aucune FAQ disponible)";
  return kb.map((k, i) => `[FAQ ${i + 1}] Q: ${k.question}\nR: ${k.answer}`).join("\n\n");
}

function buildProductBlock(p?: ProductContext) {
  if (!p) return "(aucun produit en contexte)";
  return [
    p.title && `Nom: ${p.title}`,
    p.price_usd != null && `Prix: ${p.price_usd} USD${p.price_cdf ? ` / ~${p.price_cdf} CDF` : ""}`,
    p.category && `Catégorie: ${p.category}`,
    p.link && `Lien: ${p.link}`,
  ].filter(Boolean).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const message: string = String(body.message ?? "").slice(0, 2000).trim();
    const sessionId: string = String(body.session_id ?? crypto.randomUUID());
    const conversationId: string | null = body.conversation_id ?? null;
    const product: ProductContext | undefined = body.product || undefined;
    const history: { role: string; content: string }[] = Array.isArray(body.history) ? body.history.slice(-10) : [];
    const language = (body.language || "fr").toLowerCase();
    const userId: string | null = body.user_id ?? null;

    if (!message) {
      return new Response(JSON.stringify({ error: "message required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Upsert conversation
    let convId = conversationId;
    if (!convId) {
      const { data: conv, error } = await supabase
        .from("chatbot_conversations")
        .insert({ session_id: sessionId, user_id: userId, product_context: product || null, language })
        .select("id").single();
      if (error) throw error;
      convId = conv!.id;
    }

    // Save user message
    await supabase.from("chatbot_messages").insert({
      conversation_id: convId, role: "user", content: message,
    });

    const kb = await fetchKb(supabase, language === "en" ? "en" : "fr");

    const systemPrompt = `${BUSINESS_CONTEXT_FR}

Base de connaissances (utilise-la en priorité):
${buildKbBlock(kb)}

Contexte produit:
${buildProductBlock(product)}

INSTRUCTIONS DE RÉPONSE (strict JSON, aucun markdown autour):
{
  "answer": "réponse en français, courte et amicale",
  "classification": {
    "category": "PRODUCT_DISCOVERY|PRODUCT_INFORMATION|ORDER_STATUS|PAYMENT|SHIPPING_DELIVERY|RETURNS_REFUNDS|ACCOUNT|TRUST_SAFETY|VEHICLE_PURCHASE|COMPLAINT|TECHNICAL_ISSUE|GENERAL",
    "intent": "FIND_PRODUCT|PRODUCT_AVAILABILITY|HOW_TO_PAY|PAYMENT_FAILED|DELIVERY_TIME|DELIVERY_COST|TRACK_ORDER|IS_LEGIT|VEHICLE_PRICE_ESTIMATE|HUMAN_REQUESTED|UNKNOWN_QUESTION|OTHER",
    "sentiment": "positive|neutral|negative|angry",
    "product_requested": ""
  },
  "confidence": 0.0,
  "needs_escalation": false,
  "escalation_reason": "ORDER_EXCEPTION|REFUND_REQUEST|ANGRY_CUSTOMER|PAYMENT_DISPUTE|MISSING_PRODUCT|DAMAGED_PRODUCT|HIGH_VALUE_ORDER|HUMAN_REQUESTED|UNKNOWN_QUESTION|VEHICLE_PRICING_UNKNOWN|"
}

Règles d'escalade — needs_escalation=true si:
- confidence < 0.70
- client demande un humain/agent
- client est en colère ou se plaint d'un produit endommagé/manquant
- demande de remboursement, litige de paiement
- question véhicule sans données précises
- tu ne connais pas la réponse — NE PAS inventer

Si needs_escalation=true, le champ "answer" doit être exactement:
"Je préfère vous mettre en contact avec notre équipe afin de vous donner une réponse exacte."`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map(h => ({ role: h.role === "assistant" ? "assistant" : "user", content: String(h.content).slice(0, 1000) })),
      { role: "user", content: message },
    ];

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI gateway error", aiResp.status, errText);
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "credits_exhausted" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI ${aiResp.status}`);
    }

    const aiJson = await aiResp.json();
    const raw = aiJson.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch {
      parsed = { answer: raw, classification: {}, confidence: 0.5, needs_escalation: false };
    }

    const confidence = Number(parsed.confidence ?? 0.5);
    let needsEscalation = !!parsed.needs_escalation || confidence < 0.7;
    let escalationReason = parsed.escalation_reason || (needsEscalation ? "UNKNOWN_QUESTION" : "");
    let answer: string = String(parsed.answer || "").trim();

    if (needsEscalation) {
      answer = "Je préfère vous mettre en contact avec notre équipe afin de vous donner une réponse exacte.";
    }

    // Save assistant message
    await supabase.from("chatbot_messages").insert({
      conversation_id: convId,
      role: "assistant",
      content: answer,
      classification: parsed.classification || {},
      confidence,
      needs_escalation: needsEscalation,
      escalation_reason: escalationReason || null,
    });

    await supabase
      .from("chatbot_conversations")
      .update({
        last_message_at: new Date().toISOString(),
        escalated: needsEscalation,
        escalation_reason: needsEscalation ? escalationReason : null,
      })
      .eq("id", convId);

    return new Response(JSON.stringify({
      conversation_id: convId,
      answer,
      classification: parsed.classification || {},
      confidence,
      needs_escalation: needsEscalation,
      escalation_reason: escalationReason,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({
      error: "internal",
      answer: "Je préfère vous mettre en contact avec notre équipe afin de vous donner une réponse exacte.",
      needs_escalation: true,
      escalation_reason: "TECHNICAL_ISSUE",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
