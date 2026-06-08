// AfriShop AI Chatbot — strict guardrails edition.
// RAG over faq_kb + knowledge_base_articles + AfriShop business context.
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

// --- Guardrail constants ---
const FORBIDDEN_PAYMENT_TERMS = [/maishapay/gi, /myshoppay/gi, /my\s*shop\s*pay/gi, /flutterwave/gi, /paypal/gi];
const SENSITIVE_PATTERNS = [
  { re: /\b(?:\d[ -]*?){13,19}\b/g, replace: "[CARD_REDACTED]" }, // card numbers
  { re: /\bcvv\s*[:=]?\s*\d{3,4}\b/gi, replace: "[CVV_REDACTED]" },
  { re: /\botp\s*[:=]?\s*\d{4,8}\b/gi, replace: "[OTP_REDACTED]" },
  { re: /\bpin\s*[:=]?\s*\d{4,8}\b/gi, replace: "[PIN_REDACTED]" },
  { re: /\bpassword\s*[:=]?\s*\S+/gi, replace: "[PASSWORD_REDACTED]" },
  { re: /\bmot\s*de\s*passe\s*[:=]?\s*\S+/gi, replace: "[PASSWORD_REDACTED]" },
];

const WHATSAPP_ESCALATION_FR = "Je préfère vous mettre en contact avec notre équipe afin de vous donner une réponse exacte.";
const WHATSAPP_ESCALATION_EN = "I'd prefer to connect you with our team so we can give you an accurate answer.";

function sanitizeInput(text: string): string {
  let out = text;
  for (const p of SENSITIVE_PATTERNS) out = out.replace(p.re, p.replace);
  return out;
}

function scrubPaymentTerms(text: string): string {
  let out = text;
  for (const re of FORBIDDEN_PAYMENT_TERMS) out = out.replace(re, "PawaPay/Stripe");
  return out;
}

function detectLanguage(text: string, fallback: string): "fr" | "en" {
  const t = text.toLowerCase();
  // Strong French signals
  if (/[àâçéèêëîïôûùüÿœæ]/.test(t)) return "fr";
  if (/\b(le|la|les|je|vous|bonjour|merci|combien|comment|où|quand|pourquoi|livraison|paiement|commande)\b/.test(t)) return "fr";
  // English signals
  if (/\b(the|how|what|when|where|why|hello|hi|payment|delivery|order|please|thanks)\b/.test(t)) return "en";
  return fallback === "en" ? "en" : "fr";
}

const BUSINESS_CONTEXT_FR = `
AfriShop (American Goodwill SARL, RDC) aide les clients en RDC à acheter des produits depuis les USA et à les recevoir au Congo.

Modèle:
- Le client parcourt les produits, clique sur "Payer", saisit ses infos (nom, email, adresse), choisit Mobile Money (PawaPay) ou carte bancaire (Stripe), puis confirme le paiement.
- Dès le paiement confirmé, AfriShop lance la commande USA → RDC.
- Délai de livraison typique: 10 à 17 jours selon la ville (ne JAMAIS donner de date exacte).
- Prix affichés en USD; total également affiché en CDF au checkout.
- Paiement en 1 fois OU plan acompte 30% / solde 70% à l'arrivée (selon éligibilité).
- Produits interdits: livres, contenu numérique, abonnements, articles adultes/NSFW.
- Statuts commande: DRAFT, PENDING_PAYMENT, PAID, PROCESSING, SHIPPED, COMPLETED.
- Programme parrainage: 10% commission via mobile money après seuil de 5 USD.
- Véhicules: marges variables selon la valeur. Si données précises manquantes, NE PAS deviner — escalader.

⚠️ PAIEMENTS — STRICT:
- Seuls Stripe (carte) et PawaPay (Mobile Money) sont autorisés.
- INTERDICTION ABSOLUE de mentionner MaishaPay, MyShopPay, PayPal, Flutterwave ou tout autre fournisseur.

⚠️ NE JAMAIS INVENTER:
- prix, dates de livraison exactes, remboursements, disponibilité produit hors base, confirmations de paiement, numéros de suivi, frais de douane, prix final véhicule.
- adresse, numéro de registre (RCCM/IDNAT), bureau, horaires, téléphone, ou toute information légale/société.
- Si l'info n'est pas dans la base de connaissances/produit/commande → escalader.

⚠️ LÉGITIMITÉ & SOCIÉTÉ — STRICT RAG:
- Pour toute question type "êtes-vous réels / légitimes / où êtes-vous / avez-vous un bureau / quelle société opère AfriShop / numéro de registre / adresse" → réponds UNIQUEMENT avec le contenu textuel exact présent dans la base de connaissances (FAQ ou ARTICLE).
- Si l'information officielle (raison sociale, RCCM, IDNAT, adresse, bureau, téléphone) N'EST PAS présente dans la base de connaissances ci-dessous → needs_escalation=true, escalation_reason="UNKNOWN_QUESTION", classification.category="TRUST_SAFETY", classification.intent="IS_LEGIT". NE PAS inventer, NE PAS deviner, NE PAS citer de mémoire.

Tu es Sophie, l'assistante virtuelle d'AfriShop. Réponses courtes, claires, amicales, professionnelles.
Si le client écrit en anglais, réponds en anglais. Sinon, en français.
Si hors-sujet (non lié à AfriShop) → redirige poliment ou escalade.
Si client en colère → présente UNE excuse brève puis escalade.
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
  const [faq, kba] = await Promise.all([
    supabase.from("faq_kb").select("question,answer").eq("is_active", true).eq("language", language)
      .order("priority", { ascending: false }).limit(25),
    supabase.from("knowledge_base_articles").select("title,content").eq("is_published", true).limit(15),
  ]);
  const faqRows = (faq.data || []) as { question: string; answer: string }[];
  const kbaRows = (kba.data || []) as { title: string; content: string }[];
  return { faqRows, kbaRows };
}

function buildKbBlock(faq: { question: string; answer: string }[], kba: { title: string; content: string }[]) {
  const parts: string[] = [];
  faq.forEach((k, i) => parts.push(`[FAQ ${i + 1}] Q: ${k.question}\nR: ${k.answer}`));
  kba.forEach((k, i) => parts.push(`[ARTICLE ${i + 1}] ${k.title}\n${String(k.content || "").slice(0, 600)}`));
  return parts.length ? parts.join("\n\n") : "(aucune source disponible)";
}

function buildProductBlock(p?: ProductContext) {
  if (!p) return "(aucun produit en contexte)";
  return [
    p.title && `Nom: ${p.title}`,
    p.id && `ID: ${p.id}`,
    p.price_usd != null && `Prix: ${p.price_usd} USD${p.price_cdf ? ` / ~${p.price_cdf} CDF` : ""}`,
    p.category && `Catégorie: ${p.category}`,
    p.link && `Lien: ${p.link}`,
  ].filter(Boolean).join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const rawMessage: string = String(body.message ?? "").slice(0, 2000).trim();
    const sessionId: string = String(body.session_id ?? crypto.randomUUID());
    const conversationId: string | null = body.conversation_id ?? null;
    const product: ProductContext | undefined = body.product || undefined;
    const history: { role: string; content: string }[] = Array.isArray(body.history) ? body.history.slice(-10) : [];
    const userId: string | null = body.user_id ?? null;
    const requestedLang = (body.language || "fr").toLowerCase();

    if (!rawMessage) {
      return new Response(JSON.stringify({ error: "message required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sanitize sensitive data BEFORE storing or sending to AI
    const message = sanitizeInput(rawMessage);
    const lang = detectLanguage(message, requestedLang);
    const fallbackAnswer = lang === "en" ? WHATSAPP_ESCALATION_EN : WHATSAPP_ESCALATION_FR;

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    let convId = conversationId;
    if (!convId) {
      const { data: conv, error } = await supabase
        .from("chatbot_conversations")
        .insert({ session_id: sessionId, user_id: userId, product_context: product || null, language: lang })
        .select("id").single();
      if (error) throw error;
      convId = conv!.id;
    }

    // Store sanitized user message (no card/OTP/passwords)
    await supabase.from("chatbot_messages").insert({
      conversation_id: convId, role: "user", content: message,
    });

    const { faqRows, kbaRows } = await fetchKb(supabase, lang === "en" ? "en" : "fr");

    const systemPrompt = `${BUSINESS_CONTEXT_FR}

Base de connaissances (UNIQUE source autorisée pour les faits — utilise-la, ne devine PAS):
${buildKbBlock(faqRows, kbaRows)}

Contexte produit:
${buildProductBlock(product)}

Langue de réponse: ${lang === "en" ? "English" : "Français"}

INSTRUCTIONS DE RÉPONSE (strict JSON, aucun markdown autour):
{
  "answer": "réponse courte, dans la langue du client",
  "classification": {
    "category": "PRODUCT_DISCOVERY|PRODUCT_INFORMATION|ORDER_STATUS|PAYMENT|SHIPPING_DELIVERY|RETURNS_REFUNDS|ACCOUNT|TRUST_SAFETY|VEHICLE_PURCHASE|COMPLAINT|TECHNICAL_ISSUE|OFF_TOPIC|GENERAL",
    "intent": "FIND_PRODUCT|PRODUCT_AVAILABILITY|HOW_TO_PAY|PAYMENT_FAILED|DELIVERY_TIME|DELIVERY_COST|TRACK_ORDER|IS_LEGIT|VEHICLE_PRICE_ESTIMATE|HUMAN_REQUESTED|UNKNOWN_QUESTION|OFF_TOPIC|OTHER",
    "sentiment": "positive|neutral|negative|angry",
    "product_requested": "",
    "missing_faq_topic": "",
    "suggested_business_action": ""
  },
  "confidence": 0.0,
  "needs_escalation": false,
  "escalation_reason": "ORDER_EXCEPTION|REFUND_REQUEST|ANGRY_CUSTOMER|PAYMENT_DISPUTE|PAYMENT_FAILED|MISSING_PRODUCT|DAMAGED_PRODUCT|HIGH_VALUE_ORDER|HUMAN_REQUESTED|UNKNOWN_QUESTION|VEHICLE_PRICING_UNKNOWN|TRACKING_UNAVAILABLE|OFF_TOPIC|RAG_NO_ANSWER|"
}

Règles de confiance:
- confidence >= 0.85 → réponse normale
- 0.70 ≤ confidence < 0.85 → réponse prudente; suggère le checkout SEULEMENT si produit/paiement confirmés
- confidence < 0.70 → needs_escalation=true
- confidence < 0.50 → needs_escalation=true immédiat, pas de tentative de réponse

Règles d'escalade — needs_escalation=true si:
- client demande un humain/agent
- paiement échoué, litige paiement, remboursement, commande manquante
- suivi indisponible, produit endommagé, client en colère
- véhicule sans données précises, disponibilité produit incertaine
- RAG ne contient pas la réponse
- question hors AfriShop (OFF_TOPIC)

NE JAMAIS:
- inventer prix, dates, suivi, douane, prix véhicule final
- mentionner MaishaPay/MyShopPay/PayPal/Flutterwave
- donner conseil légal, financier, médical, ou d'immigration
- afficher la confidence au client

Si needs_escalation=true, "answer" doit être exactement: "${fallbackAnswer}"`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map(h => ({
        role: h.role === "assistant" ? "assistant" : "user",
        content: sanitizeInput(String(h.content)).slice(0, 1000),
      })),
      { role: "user", content: message },
    ];

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages,
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });

    if (!aiResp.ok) {
      const errText = await aiResp.text();
      console.error("AI gateway error", aiResp.status, errText);
      // Fail-safe: escalate
      return new Response(JSON.stringify({
        conversation_id: convId,
        answer: fallbackAnswer,
        classification: {},
        confidence: 0,
        needs_escalation: true,
        escalation_reason: "TECHNICAL_ISSUE",
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiJson = await aiResp.json();
    const raw = aiJson.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch {
      parsed = { answer: "", classification: {}, confidence: 0, needs_escalation: true, escalation_reason: "RAG_NO_ANSWER" };
    }

    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));
    const classification = parsed.classification || {};
    const sentiment = String(classification.sentiment || "").toLowerCase();

    // Hard guardrails on top of AI decision
    let needsEscalation =
      !!parsed.needs_escalation ||
      confidence < 0.70 ||
      sentiment === "angry" ||
      classification.intent === "HUMAN_REQUESTED" ||
      classification.intent === "PAYMENT_FAILED" ||
      classification.category === "RETURNS_REFUNDS" ||
      classification.category === "COMPLAINT" ||
      classification.category === "OFF_TOPIC";

    let escalationReason = parsed.escalation_reason || "";
    if (needsEscalation && !escalationReason) {
      escalationReason = sentiment === "angry" ? "ANGRY_CUSTOMER"
        : classification.intent === "HUMAN_REQUESTED" ? "HUMAN_REQUESTED"
        : classification.category === "OFF_TOPIC" ? "OFF_TOPIC"
        : confidence < 0.70 ? "RAG_NO_ANSWER"
        : "UNKNOWN_QUESTION";
    }

    let answer: string = String(parsed.answer || "").trim();

    // Scrub forbidden payment terms from any AI output
    answer = scrubPaymentTerms(answer);

    if (needsEscalation || !answer) {
      answer = fallbackAnswer;
    }

    // Strip any leaked confidence mentions
    answer = answer.replace(/confidence[^.]*\./gi, "").trim();

    // Persist business-safe metadata only
    const safeClassification = {
      category: classification.category || null,
      intent: classification.intent || null,
      sentiment: classification.sentiment || null,
      product_requested: classification.product_requested || null,
      product_id: product?.id || null,
      product_name: product?.title || null,
      missing_faq_topic: classification.missing_faq_topic || null,
      suggested_business_action: classification.suggested_business_action || null,
      resolved: !needsEscalation,
    };

    await supabase.from("chatbot_messages").insert({
      conversation_id: convId,
      role: "assistant",
      content: answer,
      classification: safeClassification,
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

    // NEVER return confidence to client
    return new Response(JSON.stringify({
      conversation_id: convId,
      answer,
      classification: {
        category: safeClassification.category,
        intent: safeClassification.intent,
      },
      needs_escalation: needsEscalation,
      escalation_reason: needsEscalation ? escalationReason : null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({
      error: "internal",
      answer: WHATSAPP_ESCALATION_FR,
      needs_escalation: true,
      escalation_reason: "TECHNICAL_ISSUE",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
