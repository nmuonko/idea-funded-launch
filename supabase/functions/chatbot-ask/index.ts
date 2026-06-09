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
const FORBIDDEN_PAYMENT_TERMS: { re: RegExp; replace: string }[] = [
  { re: /\bmaishapay\b/gi, replace: "Mobile Money" },
  { re: /\bmyshoppay\b/gi, replace: "Mobile Money" },
  { re: /\bmy\s*shop\s*pay\b/gi, replace: "Mobile Money" },
  { re: /\bflutterwave\b/gi, replace: "Mobile Money" },
  { re: /\bpaypal\b/gi, replace: "carte bancaire" },
  { re: /\bpawa\s*pay\b/gi, replace: "Mobile Money" },
  { re: /\bstripe\b/gi, replace: "carte bancaire" },
];
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
  for (const { re, replace } of FORBIDDEN_PAYMENT_TERMS) out = out.replace(re, replace);
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
- Le client parcourt les produits, clique sur "Payer", saisit ses infos (nom, email, adresse), choisit Mobile Money ou carte bancaire, puis confirme.
- Dès le paiement confirmé, AfriShop lance la commande USA → RDC.
- Délai de livraison: 2 à 4 semaines selon la ville et le moment de l'achat, la plupart arrivent en 10 jours ouvrés (ne JAMAIS donner de date exacte).
- Prix affichés en USD; total aussi affiché en CDF au checkout.
- Paiement: 100% en ligne avant expédition, OU plan 30% maintenant + 70% à la livraison avant retrait — disponible pour TOUS les clients, sans condition. NE JAMAIS dire "pas de paiement à la livraison" ni "selon éligibilité".
- Produits interdits: livres, contenu numérique, abonnements, articles adultes/NSFW.
- Parrainage: 10% commission via mobile money après seuil de 5 USD.
- Véhicules: marges variables. Si données précises manquantes, escalader.

⚠️ PAIEMENTS — STRICT (très important):
- NE JAMAIS nommer les fournisseurs techniques (interdit: Stripe, PawaPay, MaishaPay, MyShopPay, PayPal, Flutterwave, etc.).
- Dire uniquement: "Mobile Money (Airtel Money, M-Pesa, Orange Money)" OU "carte bancaire (Visa/Mastercard)".
- En anglais: "Mobile Money (Airtel Money, M-Pesa, Orange Money)" or "credit/debit card (Visa/Mastercard)".

⚠️ FRAIS DE LIVRAISON / FRAIS DE SERVICE — STRICT:
- Le prix affiché est TOUT COMPRIS. NE JAMAIS mentionner pourcentage ou frais séparés.
- FR: "Tout est déjà inclus dans le prix affiché — aucun frais supplémentaire."
- EN: "Everything is already included in the price shown — no extra fees."

⚠️ NE JAMAIS INVENTER prix, dates, suivi, douane, prix véhicule, adresse, RCCM/IDNAT, téléphone. Si l'info manque → escalader.

⚠️ LÉGITIMITÉ: réponds UNIQUEMENT avec le contenu exact de la base de connaissances. Sinon escalade (UNKNOWN_QUESTION / TRUST_SAFETY / IS_LEGIT).

Tu es Sophie, assistante AfriShop. RÉPONSES TRÈS COURTES (1-3 phrases ou bullet points courts •). Pas de pavés de texte. Amical, simple, clair.
Format préféré quand utile: petite liste à puces avec • (max 3-4 points courts).
Anglais si client écrit en anglais, sinon français.
Hors-sujet → redirige poliment (ne pas escalader).
Client en colère → 1 brève excuse puis escalade.

⚠️ NE PAS sur-escalader:
- Messages courts/ambigus ("ok", "merci", "oui", "bonjour"): réponds naturellement avec le contexte précédent.
- Questions générales AfriShop (modèle, délais, paiement, parrainage, garantie, produits interdits): RÉPONDS à partir du contexte ci-dessus.
- Escalade SEULEMENT si: humain demandé, paiement échoué, litige/remboursement, commande manquante, suivi indisponible, colère, question légale sans info, donnée factuelle précise manquante.
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

type CatalogMatch = {
  title: string;            // original (kept for scoring/debug)
  display_name: string;     // cleaned, customer-friendly
  condition: string;        // "Neuf" | "Renewed" | "Refurbished" | "Used"
  price_usd: number | null;
  product_url: string | null;
  source?: string;
};

function normalizeProductQuery(text: string) {
  return text.toLowerCase()
    .replace(/\buniphone\b/g, "iphone")
    .replace(/\buni\s+phone\b/g, "iphone")
    .replace(/\bayphone\b/g, "iphone")
    .replace(/\bayfone\b/g, "iphone")
    .replace(/\bifone\b/g, "iphone")
    .replace(/\bi-phone\b/g, "iphone")
    .replace(/\bsamsoung\b/g, "samsung")
    .replace(/\bgooglepixel\b/g, "google pixel")
    // Split glued model variants: "14pro", "14promax", "15promax", "14ProMax"
    .replace(/(\d{1,2})\s*pro\s*max\b/g, "$1 pro max")
    .replace(/(\d{1,2})\s*promax\b/g, "$1 pro max")
    .replace(/(\d{1,2})\s*pro\b/g, "$1 pro")
    .replace(/(\d{1,2})\s*plus\b/g, "$1 plus")
    .replace(/(\d{1,2})\s*mini\b/g, "$1 mini")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Phone accessory / spare-part filter — must NEVER be returned when user asks for a phone.
const PHONE_ACCESSORY_RE = /\b(accessor(?:y|ies)|case|cover|sleeve|skin|pouch|wallet|holster|screen\s*protector|tempered\s*glass|protector|charging\s*port|dock|mic\s*flex|flex\s*cable|replacement|spare\s*parts?|battery\s*replacement|battery\s*pack|camera\s*lens(?:\s*replacement)?|lcd|digitizer|cable|cord|charger|adapter|repair|housing|back\s*glass|back\s*cover|motherboard|logic\s*board|holder|mount|magsafe|strap|stand|tripod|earbuds?\s*case|grip|popsocket|car\s*mount|sim\s*tray|button|speaker\s*replacement|frame|bezel|oem\s+part)\b/i;

// Phone brand / family tokens used to detect a phone request.
const PHONE_BRAND_TOKENS = ["iphone","galaxy","pixel","motorola","moto","oneplus","xiaomi","redmi","huawei","oppo","vivo","nokia","sony\u00a0xperia","xperia"];

function isPhoneRequest(normalizedMessage: string, tokens: string[]): boolean {
  if (tokens.some(t => PHONE_BRAND_TOKENS.includes(t))) return true;
  return /\b(smartphone|t[ée]l[ée]phone|phone)\b/i.test(normalizedMessage);
}

function isPhoneTitle(title: string): boolean {
  if (!title) return false;
  if (PHONE_ACCESSORY_RE.test(title)) return false;
  // Must look like a phone (brand + model OR explicit "smartphone")
  return /\b(iphone|galaxy\s*(?:s|note|z|a|m)?\d|pixel\s*\d|moto(?:rola)?\s+\w|oneplus\s*\d|redmi|xiaomi|huawei|oppo|vivo|smartphone)\b/i.test(title);
}

// Strip noisy supplier-style fragments and shorten Amazon/eBay titles into a
// friendly product name customers can read (e.g. "Galaxy S22 128GB Phantom Black").
function cleanProductName(raw: string, lang: "fr" | "en"): string {
  if (!raw) return "";
  let t = raw;
  // Drop common marketplace prefixes / suffixes
  t = t.replace(/^\s*(Amazon\.com[:\-]?|eBay[:\-]?|New\s+Listing[:\-]?)\s*/i, "");
  t = t.replace(/\s*:\s*Cell Phones.*$/i, "");
  t = t.replace(/\s*-\s*(?:Cell Phones|Electronics|Computers).*$/i, "");
  // Remove parenthetical noise: "(Unlocked)", "(Renewed)", "(US Version)", etc.
  t = t.replace(/\s*\([^)]*\)/g, " ");
  // Remove seller / version / region tags
  t = t.replace(/\b(US Version|International Version|Factory Unlocked|GSM Unlocked|Unlocked|SIM Free|Dual SIM|Single SIM|eSIM|Brand New|Sealed|Open Box|Renewed|Refurbished|Pre-?Owned|Used|For (?:T-Mobile|AT&T|Verizon|Sprint|Cricket|Metro)|Locked to [^,]+|Smartphone|Android Cell Phone|Cell Phone)\b/gi, " ");
  // Remove ampersand-tail noise like "Camera & …"
  t = t.replace(/\s*[,&]\s*(?:8K\s+Camera|Camera|Charger|Cable|Box|Accessories?).*$/i, "");
  // Remove trailing seller bits after dashes/commas
  t = t.replace(/\s*[-–—,]\s*$/g, "");
  // Collapse whitespace and stray punctuation
  t = t.replace(/[•|]+/g, " ").replace(/,\s*,+/g, ",").replace(/\s{2,}/g, " ").replace(/\s+,/g, ",").trim();
  // Trim trailing commas / dashes / ellipses-leading punctuation
  t = t.replace(/[,;:\-–—]+$/g, "").trim();
  t = t.replace(/^[,;:\-–—]+/g, "").trim();
  // Cap length so it stays one short clickable line
  const MAX = 70;
  if (t.length > MAX) t = t.slice(0, MAX).replace(/\s+\S*$/, "") + "…";
  return t || raw;
}

function detectCondition(title: string, lang: "fr" | "en"): string {
  const t = (title || "").toLowerCase();
  if (/\brenewed\b/.test(t)) return "Renewed";
  if (/\brefurbished?\b/.test(t)) return "Refurbished";
  if (/\b(used|pre[- ]?owned|second[- ]?hand)\b/.test(t)) return lang === "en" ? "Used" : "Occasion";
  // Default for AfriShop: phones are sold new unless title explicitly says otherwise.
  return lang === "en" ? "New" : "Neuf";
}

const CONDITION_TAGLINE_FR: Record<string, string> = {
  "Neuf": "Neuf",
  "Renewed": "Renewed (reconditionné par le vendeur, garantie)",
  "Refurbished": "Refurbished (reconditionné, garantie)",
  "Occasion": "Occasion",
};
const CONDITION_TAGLINE_EN: Record<string, string> = {
  "New": "New",
  "Renewed": "Renewed (seller-refurbished, warranty)",
  "Refurbished": "Refurbished (warranty)",
  "Used": "Used",
};

function formatPriceAnswer(matches: CatalogMatch[], lang: "fr" | "en", opts?: { wantsNew?: boolean }): string {
  let useful = matches.filter(p => p.price_usd != null);
  if (!useful.length) return "";

  // If the customer asked for "neuf / sealed / brand new", prefer New items.
  if (opts?.wantsNew) {
    const newOnly = useful.filter(p => {
      const c = (p.condition || "").toLowerCase();
      return c === "neuf" || c === "new";
    });
    if (newOnly.length > 0) useful = newOnly;
  }

  useful = useful.slice(0, 3);
  const sorted = [...useful].sort((a, b) => (a.price_usd! - b.price_usd!));
  const taglineMap = lang === "en" ? CONDITION_TAGLINE_EN : CONDITION_TAGLINE_FR;
  const ctaLabel = lang === "en" ? "Order now" : "Commander maintenant";
  const shippingLine = lang === "en" ? "Delivery to DRC included" : "Livraison RDC incluse";

  const blockFor = (p: CatalogMatch) => {
    const price = `${Number(p.price_usd).toLocaleString("en-US", { maximumFractionDigits: 2 })} USD`;
    const name = p.display_name || cleanProductName(p.title, lang);
    const cond = taglineMap[p.condition] || p.condition;
    const cta = p.product_url ? `[${ctaLabel}](${p.product_url})` : ctaLabel;
    return `${name} — ${price}\n${cond} · ${shippingLine}\n${cta}`;
  };

  const recommended = sorted.length >= 2 ? sorted[Math.floor(sorted.length / 2)] : sorted[0];
  const recName = recommended.display_name || cleanProductName(recommended.title, lang);

  if (lang === "en") {
    return [
      `Yes 👌 We have options for you.`,
      ``,
      ...sorted.map(blockFor).map(b => b + "\n"),
      `I'd recommend ${recName} for the best balance.`,
      `Which one would you like to order?`,
    ].join("\n");
  }
  return [
    `Oui 👌 Nous avons des options pour vous.`,
    ``,
    ...sorted.map(blockFor).map(b => b + "\n"),
    `Je vous recommande ${recName} pour le meilleur équilibre.`,
    `Lequel souhaitez-vous commander ?`,
  ].join("\n");
}

function buildInternalProductUrl(
  baseUrl: string,
  source: string | undefined,
  row: { id?: string | null; provider?: string | null; provider_product_id?: string | null },
): string | null {
  const base = (baseUrl || "https://afrishop-usa.com").replace(/\/$/, "");
  if (source === "hot_products_showcase" && row.id) {
    return `${base}/checkout?hp=${encodeURIComponent(row.id)}`;
  }
  if (source === "catalog_items" && row.provider && row.provider_product_id) {
    return `${base}/product/${encodeURIComponent(row.provider)}/${encodeURIComponent(row.provider_product_id)}`;
  }
  return null;
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

    // Product price lookup: if user mentions a product, search the catalogue and hot products.
    let catalogMatches: CatalogMatch[] = [];
    try {
      // Normalize common typos / phonetic spellings before tokenizing
      const normalized = normalizeProductQuery(message);

      const stop = new Set([
        // Articles / generic
        "the","a","an","is","of","for","and","or","to","in","on","with","price","cost","prix","combien","quel","quelle","est","le","la","les","un","une","de","du","des","pour","ça","ca","coute","coûte","cout","much","how","what","tell","me","please","svp","stp","s'il","plait","plaît","combine",
        // Greetings
        "bonjour","bonsoir","salut","hello","hey","coucou","merci","thanks","thank",
        // Intent / request verbs
        "besoin","cherche","recherche","voudrais","veux","voulais","achat","acheter","commander","order","buy","need","looking","want","get","take",
        // Condition keywords (we want the device, not other items titled "new")
        "tout","neuf","neuve","carton","scelle","scellé","scellee","scellée","sealed","brand","new","nouveau","nouvelle","original","authentique","authentic",
        // Filler
        "moi","mon","ma","mes","ton","ta","tes","son","sa","ses","notre","votre","leur","aussi","juste","seulement","only","just",
      ]);
      const tokens = normalized
        .replace(/[^\p{L}\p{N}\s-]/gu, " ")
        .split(/\s+/)
        .filter(w => (/^\d{2,}$/.test(w) || w.length > 2) && !stop.has(w));
      const mustHave = ["iphone", "samsung", "pixel", "galaxy", "macbook", "ipad", "airpods"].filter(t => tokens.includes(t));

      const catalogQuery = () => supabase
        .from("catalog_items")
        .select("id,provider,provider_product_id,title,price_usd,condition")
        .eq("is_active", true)
        .not("price_usd", "is", null)
        .order("popularity_score", { ascending: false, nullsFirst: false })
        .limit(5);

      const hotProductsQuery = () => supabase
        .from("hot_products_showcase")
        .select("id,title,total_price_usd,price_usd")
        .eq("is_active", true)
        .not("total_price_usd", "is", null)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .limit(5);

      const baseUrl = (req.headers.get("origin") || Deno.env.get("FRONTEND_BASE_URL") || "https://afrishop-usa.com").trim();

      const addMatches = (rows: any[] | null | undefined, source: string) => {
        for (const r of rows || []) {
          const price = r.total_price_usd ?? r.price_usd ?? null;
          if (!r.title || price == null) continue;
          const internalUrl = buildInternalProductUrl(baseUrl, source, r);
          if (!catalogMatches.some(m => m.title === r.title && m.product_url === internalUrl)) {
            catalogMatches.push({
              title: r.title,
              display_name: cleanProductName(r.title, lang),
              condition: r.condition && String(r.condition).trim() ? String(r.condition).trim() : detectCondition(r.title, lang),
              price_usd: Number(price),
              product_url: internalUrl,
              source,
            });
          }
        }
      };

      if (tokens.length > 0) {
        // 1) Exact all-token title match in hot products first (these are visible storefront products).
        let hot = hotProductsQuery();
        for (const t of tokens) hot = hot.ilike("title", `%${t}%`);
        const { data: hotExact } = await hot;
        addMatches(hotExact, "hot_products_showcase");

        // 2) Full-text catalog search
        const { data } = await catalogQuery()
          .textSearch("search_text", tokens.join(" & "), { type: "websearch", config: "simple" });
        addMatches(data, "catalog_items");

        // 3) Fallback: ilike on title with brand + longest model token, not accessories-only noise.
        if (catalogMatches.length === 0) {
          const longest = [...tokens].sort((a, b) => b.length - a.length)[0];
          const titleNeedles = [...new Set([...mustHave, longest])].filter(Boolean);
          let hotLoose = hotProductsQuery();
          for (const t of titleNeedles) hotLoose = hotLoose.ilike("title", `%${t}%`);
          const [{ data: hotLooseData }, { data: data2 }] = await Promise.all([
            hotLoose,
            catalogQuery().ilike("title", `%${longest}%`),
          ]);
          addMatches(hotLooseData, "hot_products_showcase");
          addMatches(data2, "catalog_items");
        }

        // 4) Last resort: brand token via hot products, then catalog.
        if (catalogMatches.length === 0) {
          for (const t of mustHave.length ? mustHave : tokens) {
            const [{ data: h3 }, { data: d3 }] = await Promise.all([
              hotProductsQuery().ilike("title", `%${t}%`),
              catalogQuery().ilike("title", `%${t}%`),
            ]);
            addMatches(h3, "hot_products_showcase");
            addMatches(d3, "catalog_items");
            if (catalogMatches.length > 0) break;
          }
        }

        // Phone request: STRICT — drop every accessory/spare-part listing.
        const phoneRequest = isPhoneRequest(normalized, tokens);
        if (phoneRequest) {
          catalogMatches = catalogMatches.filter(p => isPhoneTitle(p.title));
        } else if (mustHave.length > 0) {
          // Generic device request: still prefer non-accessories.
          const deviceMatches = catalogMatches.filter(p => !PHONE_ACCESSORY_RE.test(p.title));
          if (deviceMatches.length > 0) catalogMatches = deviceMatches;
        }

        catalogMatches = catalogMatches
          .map(p => {
            const title = normalizeProductQuery(p.title);
            const tokenScore = tokens.reduce((sum, t) => sum + (title.includes(t) ? (/^\d+$/.test(t) ? 30 : 10) : -8), 0);
            const hotBoost = p.source === "hot_products_showcase" ? 35 : 0;
            return { ...p, _score: tokenScore + hotBoost } as CatalogMatch & { _score: number };
          })
          .sort((a, b) => b._score - a._score)
          .slice(0, 5)
          .map(({ _score, ...p }) => p);
      }
    } catch (e) {
      console.warn("catalog lookup failed", e);
    }

    const catalogBlock = catalogMatches.length
      ? catalogMatches.map((p, i) => `[PRODUIT ${i + 1}] ${p.display_name} — ${p.price_usd} USD — état: ${p.condition}${p.product_url ? ` — ${p.product_url}` : ""}`).join("\n")
      : "(aucun produit correspondant trouvé dans le catalogue)";

    const systemPrompt = `${BUSINESS_CONTEXT_FR}

Base de connaissances (UNIQUE source autorisée pour les faits — utilise-la, ne devine PAS):
${buildKbBlock(faqRows, kbaRows)}

Catalogue AfriShop (produits réels, prix tout-inclus en USD — utilise ces prix si le client demande un prix):
${catalogBlock}

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
- confidence >= 0.70 → réponse normale
- 0.45 ≤ confidence < 0.70 → réponse prudente OU pose une question de clarification (ne pas escalader)
- confidence < 0.45 → needs_escalation=true

💳 LIEN DE PAIEMENT (CRITIQUE):
- Si l'utilisateur demande COMMENT PAYER, où payer, le lien, "je veux payer", "payer maintenant" (intent HOW_TO_PAY) ET qu'un produit est en contexte avec un "Lien:", tu DOIS inclure ce lien EXACT dans la réponse sur sa propre ligne.
- Format FR: "Voici votre lien de paiement sécurisé :\n<LIEN>\nCliquez pour finaliser votre commande."
- Format EN: "Here is your secure payment link:\n<LIEN>\nClick to complete your order."
- N'invente JAMAIS de lien. Si aucun "Lien:" n'est fourni, explique simplement les étapes de paiement sans lien.

Règles d'escalade — needs_escalation=true si:
- client demande un humain/agent
- paiement échoué, litige paiement, remboursement, commande manquante
- suivi indisponible, produit endommagé, client en colère
- véhicule sans données précises, disponibilité produit incertaine
- RAG ne contient pas la réponse
- question hors AfriShop (OFF_TOPIC)

💰 PRIX PRODUIT (CRITIQUE):
- Si le client demande le prix d'un produit ET qu'un produit correspondant apparaît dans "Catalogue AfriShop", DONNE le prix exact en USD depuis le catalogue (tout inclus).
- Format court FR: "Le {produit} est à {X} USD chez nous (tout inclus). [Voir le produit]({lien})"
- Format court EN: "The {product} is {X} USD with us (all included). [View]({link})"
- Si plusieurs correspondances, propose les 2-3 plus pertinentes en bullets avec prix et lien.
- Si le modèle EXACT demandé n'est pas dans le catalogue MAIS des modèles similaires/proches y figurent (ex: client demande "iPhone 17 Pro Max", catalogue contient "iPhone 15 Pro Max"), propose ces alternatives avec prix. Exemple FR: "Je n'ai pas exactement ce modèle, mais voici des modèles proches disponibles: • iPhone 15 Pro Max — 1450 USD [lien]". NE PAS escalader.
- Si AUCUN produit même approximatif n'est trouvé, dis: FR "Je n'ai pas ce modèle ni de modèle similaire dans notre catalogue actuel. Voulez-vous que je vous mette en contact avec un agent pour un devis personnalisé ?" / EN equivalent. Dans ce cas seulement, needs_escalation peut être true.
- NE JAMAIS demander au client de coller un lien Amazon/Alibaba.
- Une question de prix n'est JAMAIS OFF_TOPIC ni RAG_NO_ANSWER tant que le catalogue contient des produits proches.

NE JAMAIS:
- inventer des prix qui ne sont pas dans le catalogue ou le contexte produit
- mentionner MaishaPay/MyShopPay/PayPal/Flutterwave
- demander au client de coller un lien externe (Amazon, Alibaba, etc.)
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

    // Hard guardrails on top of AI decision — only escalate when we truly need a human.
    // Off-topic and low-confidence are handled with a polite redirect/clarification, not escalation.
    let needsEscalation =
      !!parsed.needs_escalation ||
      confidence < 0.45 ||
      sentiment === "angry" ||
      classification.intent === "HUMAN_REQUESTED" ||
      classification.intent === "PAYMENT_FAILED" ||
      classification.category === "RETURNS_REFUNDS";

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

    // DETERMINISTIC product-catalog override: whenever we found matching products in the
    // AfriShop catalog AND the user is clearly asking about / requesting one, answer with
    // the curated catalog response — no escalation, no Amazon/eBay leakage.
    const priceQuestionRe = /(combien|combine|prix|co[uû]te|cout|cost|price|how\s+much)/i;
    const productIntentRe = /(disponible|avez[- ]vous|avez vous|j['e]?\s*(?:ai\s+besoin|cherche|voudrais|veux|voulais)|besoin\s+d|je cherche|cherche|recherche|achat|acheter|commander|order|buy|need|looking\s+for|want|tout\s+neuf|en\s+carton|carton\s+scell|scell[ée]|sealed|brand\s+new|new\s+in\s+box|neuf)/i;
    const wantsNew = /\b(tout\s+neuf|neuf|neuve|carton\s+scell|scell[ée]e?s?|sealed|brand\s+new|new\s+in\s+box|nib)\b/i.test(message);
    if (catalogMatches.length > 0 && (priceQuestionRe.test(message) || productIntentRe.test(message))) {
      answer = formatPriceAnswer(catalogMatches, lang, { wantsNew });
      needsEscalation = false;
      escalationReason = "";
    }

    // DETERMINISTIC payment-link override: if user asks how to pay and we have a product link,
    // always return the payment link directly (don't rely on the model to remember).
    const payIntentRe = /(comment\s+pay|où\s+pay|ou\s+pay|lien\s+de\s+paiement|payer\s+maintenant|je\s+veux\s+payer|paiement|how\s+to\s+pay|pay\s+now|payment\s+link|where\s+(do\s+i\s+|to\s+)?pay|checkout|buy\s+now)/i;
    if (product?.link && payIntentRe.test(message)) {
      const origin = req.headers.get("origin") || "";
      const fullLink = product.link.startsWith("http") ? product.link : `${origin}${product.link}`;
      answer = lang === "en"
        ? `Here is your secure payment link:\n${fullLink}\nClick to complete your order.`
        : `Voici votre lien de paiement sécurisé :\n${fullLink}\nCliquez pour finaliser votre commande.`;
      needsEscalation = false;
      escalationReason = "";
    }

    // DETERMINISTIC shipping/fees override: total price is all-inclusive.
    const shippingFeeRe = /(frais\s+de\s+livraison|frais\s+de\s+service|frais\s+suppl|co[uû]t\s+de\s+livraison|shipping\s+fee|delivery\s+fee|service\s+fee|extra\s+fee|hidden\s+fee)/i;
    if (shippingFeeRe.test(message)) {
      answer = lang === "en"
        ? "Everything is already included in the total price shown — no extra fees."
        : "Tout est déjà inclus dans le prix total affiché — aucun frais supplémentaire.";
      needsEscalation = false;
      escalationReason = "";
    }

    // DETERMINISTIC order-status override: look up the user's most recent order from the backend.
    const orderStatusRe = /(statut.*commande|suivi.*commande|où.*commande|ma\s+commande|order\s+status|track.*order|where.*order|my\s+order)/i;
    if (orderStatusRe.test(message) || classification.category === "ORDER_STATUS" || classification.intent === "TRACK_ORDER") {
      if (userId) {
        try {
          const { data: orders } = await supabase
            .from("orders")
            .select("id,order_number,status,created_at,total_usd")
            .eq("user_id", userId)
            .order("created_at", { ascending: false })
            .limit(1);
          const o = orders?.[0];
          if (o) {
            const statusLabels: Record<string, string> = {
              DRAFT: "Brouillon", PENDING_PAYMENT: "Paiement en attente", PAID: "Payée",
              PROCESSING: "En préparation", SHIPPED: "Expédiée", COMPLETED: "Livrée",
              CANCELLED: "Annulée", REFUNDED: "Remboursée",
            };
            const label = statusLabels[o.status] || o.status;
            const ref = o.order_number || o.id?.slice(0, 8);
            answer = lang === "en"
              ? `Your latest order #${ref} is: ${o.status}. You'll receive email/WhatsApp updates as it progresses.`
              : `Votre dernière commande #${ref} : ${label}. Vous recevrez des notifications par email/WhatsApp à chaque étape.`;
          } else {
            answer = lang === "en"
              ? "I don't see any order on your account yet. Once you place one, we'll send email/WhatsApp updates at each step."
              : "Je ne vois aucune commande sur votre compte pour l'instant. Dès que vous passerez commande, vous recevrez des notifications par email/WhatsApp à chaque étape.";
          }
        } catch {
          answer = lang === "en"
            ? "We'll send email/WhatsApp updates as your order progresses."
            : "Vous recevrez des notifications par email/WhatsApp concernant l'avancement de votre commande.";
        }
      } else {
        answer = lang === "en"
          ? "Sign in to see your order status. We also send email/WhatsApp updates at each step."
          : "Connectez-vous pour voir le statut de votre commande. Vous recevrez aussi des notifications par email/WhatsApp à chaque étape.";
      }
      needsEscalation = false;
      escalationReason = "";
    }


    if (needsEscalation || !answer) {
      answer = fallbackAnswer;
    }

    // Strip any leaked confidence mentions
    answer = answer.replace(/confidence[^.]*\./gi, "").replace(/\*\*/g, "").trim();

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
