/**
 * support-service — Consolidated Support/Chat Function (INLINED)
 *
 * Actions:
 *   start        — find or create a support conversation
 *   chat_bot     — FAQ-matching chatbot with auto-escalation + DB FAQ lookup
 *   notify_agent — assign an agent and send notifications
 *
 * AUTH: All actions require a valid JWT (via getClaims).
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function jsonRes(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getAuthHeader(req: Request): string | null {
  return req.headers.get('Authorization');
}

function createServiceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

function createUserClient(req: Request) {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: getAuthHeader(req)! } } }
  );
}

async function getUserFromRequest(req: Request): Promise<{ userId: string; user: any } | Response> {
  const authHeader = getAuthHeader(req);
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonRes({ ok: false, error: 'Unauthorized: missing Bearer token' }, 401);
  }
  const supabase = createUserClient(req);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return jsonRes({ ok: false, error: 'Unauthorized: invalid token' }, 401);
  }
  return { userId: user.id, user };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: start
// ═══════════════════════════════════════════════════════════════════════════════

const WELCOME_MESSAGES: Record<string, string> = {
  en: 'Hello! 👋 Welcome to AfriShop support. How can I help you today?\n\nI can assist with:\n• Delivery & tracking\n• Payments & billing\n• Order status\n• Returns & refunds\n\nJust type your question!',
  fr: 'Bonjour ! 👋 Bienvenue au support AfriShop. Comment puis-je vous aider ?\n\nJe peux vous assister avec :\n• Livraison & suivi\n• Paiements & facturation\n• Statut de commande\n• Retours & remboursements\n\nÉcrivez simplement votre question !',
  sw: 'Habari! 👋 Karibu kwa msaada wa AfriShop. Ninawezaje kukusaidia leo?\n\nNinaweza kusaidia na:\n• Utoaji & ufuatiliaji\n• Malipo\n• Hali ya agizo\n• Kurejesha & kurudishiwa pesa\n\nAndika swali lako!',
  ln: 'Mbote! 👋 Boyei malamu na lisungi ya AfriShop. Ndenge nini nakoki kosalisa yo lelo?\n\nNakoki kosalisa na:\n• Livraison & suivi\n• Biloko ya kofuta\n• État ya commande\n• Kozongisa & remboursement\n\nKoma motuna na yo!',
};

async function handleStart(userId: string | null, body: any): Promise<Response> {
  const supabaseAdmin = createServiceClient();
  const guestDeviceId = body.guest_device_id || null;
  const language = body.language || 'fr';

  if (!userId && !guestDeviceId) {
    return jsonRes({ ok: false, error: 'Authentication required or provide guest_device_id' }, 401);
  }

  let conversationId: string;
  const isGuest = !userId;

  if (userId) {
    const { data: existingConvo, error: findError } = await supabaseAdmin
      .from('support_conversations')
      .select('id')
      .eq('user_id', userId)
      .in('status', ['bot', 'waiting_agent', 'assigned'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findError) throw findError;

    if (existingConvo) {
      conversationId = existingConvo.id;
    } else {
      const { data: newConvo, error: createError } = await supabaseAdmin
        .from('support_conversations')
        .insert({ user_id: userId, status: 'bot', language: 'fr' })
        .select('id')
        .single();
      if (createError) throw createError;
      conversationId = newConvo.id;

      await supabaseAdmin.from('support_messages').insert({
        conversation_id: conversationId,
        sender_type: 'bot',
        content: WELCOME_MESSAGES[language] || WELCOME_MESSAGES.fr,
      });
    }
  } else {
    const { data: newConvo, error: createError } = await supabaseAdmin
      .from('support_conversations')
      .insert({ status: 'bot', language: 'fr' })
      .select('id')
      .single();
    if (createError) throw createError;
    conversationId = newConvo.id;

    await supabaseAdmin.from('support_messages').insert({
      conversation_id: conversationId,
      sender_type: 'bot',
      content: WELCOME_MESSAGES[language] || WELCOME_MESSAGES.fr,
    });
  }

  return jsonRes({ ok: true, conversation_id: conversationId, is_guest: isGuest });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: chat_bot
// ═══════════════════════════════════════════════════════════════════════════════

// Hardcoded fallback FAQ (used if DB faq_kb is empty)
const fallbackFaq: Record<string, Array<{ triggers: string[]; answer: string }>> = {
  fr: [
    { triggers: ['livraison', 'délai', 'quand', 'arriver', 'expédier'], answer: 'Les délais de livraison varient de 7 à 21 jours selon la destination. Vous pouvez suivre votre commande dans la section "Mes Commandes" de votre compte.' },
    { triggers: ['où', 'colis', 'suivi', 'tracking', 'numéro'], answer: 'Vous pouvez suivre votre commande dans "Mes Commandes". Vous y trouverez le numéro de suivi et le statut actuel de votre colis.' },
    { triggers: ['ville', 'livrer', 'kinshasa', 'lubumbashi', 'adresse', 'bureau', 'localisation', 'où êtes-vous', 'situé', 'emplacement'], answer: 'Nous avons deux bureaux en RDC :\n\n📍 Lubumbashi : 114 Croisement Av. Ndjamena & Kasaï, Q. Makutano, Lubumbashi, Haut-Katanga, RDC\n\n📍 Kinshasa : 1 Boulevard Sendwe, Matonge, C/Kalamu, Kinshasa, RDC (Maison ANL Cosmétique, Référence Bureau SONAS)\n\nNous n\'avons pas d\'autres bureaux, mais nous livrons dans toutes les zones autour de ces villes et partout en RDC.' },
    { triggers: ['négocier', 'réduire', 'discount', 'remise', 'baisser', 'cher', 'trop cher', 'prix final', 'rabais'], answer: 'Nos prix sont finaux et non négociables. Ils incluent déjà les meilleurs tarifs que nous pouvons offrir pour l\'achat et la livraison depuis les USA vers la RDC.' },
    { triggers: ['paiement', 'payer', 'mobile money', 'mpesa', 'airtel', 'orange money'], answer: 'Nous acceptons Mobile Money (M-Pesa, Airtel Money, Orange Money), les virements bancaires et les cartes de crédit.' },
    { triggers: ['échoué', 'erreur', 'problème', 'refusé', 'marche pas'], answer: 'Si votre paiement a échoué, vérifiez votre solde et réessayez. Si le problème persiste, un agent peut vous aider. Voulez-vous que je vous connecte à un agent ?' },
    { triggers: ['commande', 'statut', 'état', 'commander'], answer: 'Vous pouvez voir le statut de vos commandes dans "Mes Commandes". Les statuts possibles sont : En attente, Payé, En traitement, Expédié, Livré.' },
    { triggers: ['annuler', 'annulation'], answer: 'Pour annuler une commande non encore traitée, contactez notre support rapidement. Les commandes déjà expédiées ne peuvent pas être annulées.' },
    { triggers: ['modifier', 'changer', 'adresse'], answer: 'Pour modifier votre commande ou adresse de livraison, contactez-nous rapidement avant l\'expédition.' },
    { triggers: ['remboursement', 'rembourser', 'retour', 'retourner'], answer: 'Les remboursements sont possibles pour les produits non conformes ou endommagés. Contactez un agent pour initier la procédure. Le traitement prend 5-10 jours ouvrables.' },
    { triggers: ['prix', 'coût', 'combien', 'tarif'], answer: 'Les prix sont affichés sur chaque produit en USD. Les frais de livraison sont calculés à la commande selon la destination. Nos prix sont finaux et non négociables.' },
    { triggers: ['compte', 'inscription', 'mot de passe', 'connexion', 'connecter'], answer: 'Pour créer un compte, cliquez sur "S\'inscrire". Si vous avez oublié votre mot de passe, utilisez "Mot de passe oublié" sur la page de connexion.' },
    { triggers: ['bonjour', 'salut', 'bonsoir', 'hello', 'hi', 'coucou'], answer: 'Bonjour ! 😊 Comment puis-je vous aider aujourd\'hui ? N\'hésitez pas à poser votre question.' },
    { triggers: ['merci', 'thanks', 'ok', 'bien', 'super', 'parfait', 'génial'], answer: 'Je vous en prie ! 😊 Y a-t-il autre chose que je puisse faire pour vous ?' },
    { triggers: ['oui', 'yes', 'ouais', 'ok', 'okay', 'd\'accord'], answer: 'D\'accord ! Quelle est votre question ? Je suis là pour vous aider.' },
    { triggers: ['non', 'no', 'nan', 'pas besoin'], answer: 'D\'accord, n\'hésitez pas à revenir si vous avez besoin d\'aide. Bonne journée ! 😊' },
    { triggers: ['ebay', 'amazon', 'acheter', 'produit', 'article', 'magasin'], answer: 'AfriShop vous permet d\'acheter des produits d\'eBay et Amazon avec livraison en Afrique. Parcourez nos catégories ou utilisez la recherche pour trouver ce que vous cherchez.' },
    { triggers: ['contact', 'téléphone', 'appeler', 'whatsapp', 'email'], answer: 'Vous pouvez nous contacter par WhatsApp au +243 973 141 627 ou par email à nkadimisha@afrishop-usa.com. Un agent est également disponible ici dans le chat.' },
  ],
  en: [
    { triggers: ['delivery', 'shipping', 'when', 'arrive', 'ship'], answer: 'Delivery times vary from 7 to 21 days depending on destination. You can track your order in "My Orders".' },
    { triggers: ['where', 'package', 'track', 'tracking'], answer: 'You can track your order in "My Orders". You\'ll find the tracking number and current status there.' },
    { triggers: ['payment', 'pay', 'mobile money', 'mpesa', 'airtel'], answer: 'We accept Mobile Money (M-Pesa, Airtel Money, Orange Money), bank transfers, and credit cards.' },
    { triggers: ['failed', 'error', 'problem', 'declined'], answer: 'If your payment failed, check your balance and try again. If the problem persists, I can connect you with an agent.' },
    { triggers: ['order', 'status'], answer: 'You can see your order status in "My Orders". Possible statuses: Pending, Paid, Processing, Shipped, Delivered.' },
    { triggers: ['cancel', 'cancellation'], answer: 'To cancel an unprocessed order, contact our support. Already shipped orders cannot be cancelled.' },
    { triggers: ['refund', 'return', 'money back'], answer: 'Refunds are possible for non-conforming or damaged products. Contact an agent to initiate the process.' },
    { triggers: ['hello', 'hi', 'hey', 'good morning', 'good evening'], answer: 'Hello! 😊 How can I help you today? Feel free to ask your question.' },
    { triggers: ['thank', 'thanks', 'ok', 'great', 'perfect'], answer: 'You\'re welcome! 😊 Is there anything else I can help you with?' },
    { triggers: ['yes', 'yeah', 'okay', 'sure'], answer: 'Sure! What\'s your question? I\'m here to help.' },
    { triggers: ['no', 'nope', 'not needed'], answer: 'Alright, feel free to come back if you need help. Have a great day! 😊' },
    { triggers: ['ebay', 'amazon', 'buy', 'product', 'shop'], answer: 'AfriShop lets you buy products from eBay and Amazon with delivery to Africa. Browse our categories or use search to find what you need.' },
    { triggers: ['contact', 'phone', 'call', 'whatsapp', 'email'], answer: 'You can reach us on WhatsApp at +243 973 141 627 or email nkadimisha@afrishop-usa.com. An agent is also available here in chat.' },
  ],
};

const escalationKeywords: Record<string, string[]> = {
  fr: ['agent', 'humain', 'plainte', 'mécontent', 'arnaque', 'volé', 'urgent', 'avocat', 'scandale', 'parlé', 'parler à quelqu', 'vrai personne'],
  en: ['agent', 'human', 'complaint', 'unhappy', 'scam', 'stolen', 'urgent', 'lawyer', 'scandal', 'real person', 'speak to someone'],
  sw: ['wakala', 'mtu', 'malalamiko'],
  ln: ['agent', 'moto', 'nkanda'],
};

// Acknowledgment keywords that shouldn't trigger "I don't understand"
const acknowledgmentKeywords = ['ok', 'okay', 'd\'accord', 'j\'attend', 'j\'attends', 'bien', 'merci', 'thanks', 'thank', 'oui', 'yes', 'non', 'no', 'salut', 'bonjour', 'hello', 'hi', 'bonsoir', 'super', 'parfait', 'génial', 'great', 'perfect', 'cool', 'alright', 'sure', 'ouais', 'yeah', 'nope', 'nan'];

async function fetchFaqFromDb(supabase: any, language: string): Promise<Array<{ triggers: string[]; answer: string }>> {
  try {
    const { data, error } = await supabase
      .from('faq_kb')
      .select('trigger_phrases, answer, language')
      .eq('is_active', true)
      .eq('language', language)
      .order('priority', { ascending: true });

    if (error || !data?.length) return [];

    return data.map((row: any) => ({
      triggers: row.trigger_phrases || [],
      answer: row.answer,
    }));
  } catch {
    return [];
  }
}

function findBestAnswer(
  message: string,
  lang: string,
  dbFaq: Array<{ triggers: string[]; answer: string }>,
): { answer: string; confidence: number; shouldEscalate: boolean; matched: boolean } {
  const lowerMessage = message.toLowerCase().trim();
  const escKeywords = escalationKeywords[lang] || escalationKeywords.fr;

  // Check for escalation keywords
  for (const keyword of escKeywords) {
    if (lowerMessage.includes(keyword)) {
      return { answer: '', confidence: 0, shouldEscalate: true, matched: false };
    }
  }

  // Check if it's just an acknowledgment (don't say "I don't understand" for "ok", "merci", etc.)
  const isAcknowledgment = acknowledgmentKeywords.some(kw => {
    const clean = lowerMessage.replace(/[^a-zàâäéèêëïîôùûüÿçæœ\s]/gi, '').trim();
    return clean === kw || clean.startsWith(kw + ' ') || clean.endsWith(' ' + kw);
  });

  // Search DB FAQ first (higher priority)
  const allFaq = [...dbFaq, ...(fallbackFaq[lang] || fallbackFaq.fr || [])];

  let bestMatch = { answer: '', score: 0, totalKeywords: 1 };
  for (const item of allFaq) {
    let score = 0;
    for (const keyword of item.triggers) {
      if (lowerMessage.includes(keyword.toLowerCase())) score += 1;
    }
    if (score > bestMatch.score) {
      bestMatch = { answer: item.answer, score, totalKeywords: item.triggers.length };
    }
  }

  if (bestMatch.score >= 1) {
    const confidence = Math.min(bestMatch.score / Math.max(bestMatch.totalKeywords * 0.5, 1), 1);
    return { answer: bestMatch.answer, confidence, shouldEscalate: false, matched: true };
  }

  // If it's just an acknowledgment, respond naturally
  if (isAcknowledgment) {
    const ackResponses: Record<string, string> = {
      fr: 'D\'accord ! Y a-t-il autre chose que je puisse faire pour vous ? 😊',
      en: 'Alright! Is there anything else I can help you with? 😊',
      sw: 'Sawa! Kuna kitu kingine ninachoweza kukusaidia? 😊',
      ln: 'Malamu! Ezali na eloko mosusu nakoki kosalisa yo? 😊',
    };
    return { answer: ackResponses[lang] || ackResponses.fr, confidence: 0.6, shouldEscalate: false, matched: true };
  }

  // No match found — will be logged as unanswered
  const noMatchResponses: Record<string, string> = {
    fr: 'Je n\'ai pas trouvé de réponse précise à votre question. Voulez-vous que je vous connecte à un agent humain ? Tapez "agent" pour parler à un conseiller.',
    en: 'I couldn\'t find a specific answer to your question. Would you like me to connect you with a human agent? Type "agent" to speak with an advisor.',
    sw: 'Sijapata jibu sahihi la swali lako. Ungependa nikuunganishe na wakala? Andika "agent" kuongea na msaidizi.',
    ln: 'Nazwaki te eyano ya motuna na yo. Olingi nakangisa yo na agent? Koma "agent" mpo na kosolola na mosungi.',
  };

  return { answer: noMatchResponses[lang] || noMatchResponses.fr, confidence: 0.2, shouldEscalate: false, matched: false };
}

const ESCALATION_MESSAGES: Record<string, string> = {
  fr: "Je vous connecte avec un agent humain pour mieux vous aider. Un moment s'il vous plaît, un conseiller va prendre en charge votre conversation... 🙏",
  en: "I'm connecting you with a human agent to better assist you. One moment please, an advisor will take over your conversation... 🙏",
  sw: "Ninakuunganisha na wakala wa binadamu ili kukusaidia vizuri. Subiri kidogo, msaidizi atachukua mazungumzo yako... 🙏",
  ln: "Nazali kokangisa yo na agent ya moto mpo na kosalisa yo malamu. Zela moke, mosungi akozwa masolo na yo... 🙏",
};

const ALREADY_ESCALATED_MESSAGES: Record<string, string> = {
  fr: "Votre conversation a déjà été transmise à un agent. Un conseiller va vous répondre bientôt. Merci de patienter. 🙏",
  en: "Your conversation has already been forwarded to an agent. An advisor will respond to you shortly. Thank you for your patience. 🙏",
  sw: "Mazungumzo yako tayari yametumwa kwa wakala. Msaidizi atakujibu hivi karibuni. Asante kwa subira. 🙏",
  ln: "Masolo na yo etindamaki na agent. Mosungi akozongisela yo noki. Matondo mpo na motema molai. 🙏",
};

async function notifyAllAdminsNewMessage(supabase: any, conversationId: string, userMessage: string, userId: string) {
  try {
    // Get all admin emails from chat_routing_config + profiles
    const { data: routingAgents } = await supabase
      .from('chat_routing_config')
      .select('admin_email, admin_user_id, is_available')
      .eq('is_available', true);

    // Also get all admin users from user_roles + profiles
    const { data: adminRoles } = await supabase
      .from('user_roles')
      .select('user_id')
      .eq('role', 'admin');

    const adminUserIds = new Set<string>();
    (routingAgents || []).forEach((a: any) => adminUserIds.add(a.admin_user_id));
    (adminRoles || []).forEach((r: any) => adminUserIds.add(r.user_id));

    if (adminUserIds.size === 0) return;

    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, email, full_name')
      .in('user_id', Array.from(adminUserIds));

    const adminEmails = (profiles || [])
      .map((p: any) => p.email)
      .filter((e: string | null) => e);

    if (adminEmails.length === 0) return;

    // Get customer info
    const { data: customerProfile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('user_id', userId)
      .maybeSingle();

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const EMAIL_FROM = Deno.env.get('EMAIL_FROM_ADDRESS') || 'noreply@afrishop.com';
    const frontendUrl = Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com';

    if (!RESEND_API_KEY) {
      console.log('[support-service] No RESEND_API_KEY, skipping admin email notification');
      return;
    }

    const customerName = customerProfile?.full_name || customerProfile?.email || 'Customer';
    const truncatedMessage = userMessage.length > 200 ? userMessage.slice(0, 200) + '...' : userMessage;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: adminEmails,
        subject: `[AfriShop Chat] New message from ${customerName}`,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
            <h2 style="color:#1a1a1a;">New Support Chat Message</h2>
            <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
              <p style="margin:0 0 8px 0;"><strong>Customer:</strong> ${customerName}</p>
              <p style="margin:0 0 8px 0;"><strong>Email:</strong> ${customerProfile?.email || 'N/A'}</p>
              <p style="margin:0;"><strong>Message:</strong></p>
              <p style="margin:8px 0 0 0;padding:12px;background:white;border-radius:4px;border-left:3px solid #6366f1;">${truncatedMessage}</p>
            </div>
            <p><a href="${frontendUrl}/admin/support-inbox" style="background:#6366f1;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;">Open Support Inbox</a></p>
          </div>
        `,
      }),
    });

    console.log(`[support-service] Admin notification sent to ${adminEmails.length} admins`);
  } catch (err) {
    console.error('[support-service] Failed to send admin notification:', err);
  }
}

async function handleChatBot(userId: string, body: any, req: Request): Promise<Response> {
  const supabase = createServiceClient();
  const { conversation_id, message, language = 'fr' } = body;

  if (!conversation_id || !message) {
    return jsonRes({ error: 'conversation_id and message are required' }, 400);
  }

  // Verify conversation ownership
  const { data: conversation, error: convError } = await supabase
    .from('support_conversations')
    .select('user_id, status')
    .eq('id', conversation_id)
    .single();

  if (convError || !conversation) {
    return jsonRes({ error: 'Conversation not found' }, 404);
  }
  if (conversation.user_id !== userId) {
    return jsonRes({ error: 'Forbidden - not your conversation' }, 403);
  }

  // If conversation is already escalated (waiting_agent or assigned), don't run bot logic
  if (conversation.status === 'waiting_agent' || conversation.status === 'assigned') {
    // Just acknowledge — an agent will respond
    await supabase.from('support_messages').insert({
      conversation_id,
      sender_type: 'bot',
      content: ALREADY_ESCALATED_MESSAGES[language] || ALREADY_ESCALATED_MESSAGES.fr,
      meta: { alreadyEscalated: true },
    });

    // Notify admins of the new message
    notifyAllAdminsNewMessage(supabase, conversation_id, message, userId).catch(() => {});

    return jsonRes({ success: true, escalated: true, alreadyEscalated: true });
  }

  // Fetch FAQ from database
  const dbFaq = await fetchFaqFromDb(supabase, language);

  const { answer, confidence, shouldEscalate, matched } = findBestAnswer(message, language, dbFaq);

  // Log unanswered questions
  if (!matched && !shouldEscalate) {
    await supabase.from('support_unanswered_questions').insert({
      conversation_id,
      user_id: userId,
      question: message,
      language,
    }).then(() => {}).catch((e: any) => console.error('[support-service] Failed to log unanswered question:', e));
  }

  if (shouldEscalate) {
    // Escalate to agent
    await supabase.from('support_messages').insert({
      conversation_id,
      sender_type: 'bot',
      content: ESCALATION_MESSAGES[language] || ESCALATION_MESSAGES.fr,
      meta: { confidence: 0, shouldEscalate: true },
    });
    await supabase.from('support_conversations')
      .update({ status: 'waiting_agent', updated_at: new Date().toISOString() })
      .eq('id', conversation_id);

    // Notify admins
    notifyAllAdminsNewMessage(supabase, conversation_id, message, userId).catch(() => {});

    return jsonRes({ success: true, escalated: true });
  }

  // Insert bot response
  await supabase.from('support_messages').insert({
    conversation_id,
    sender_type: 'bot',
    content: answer,
    meta: { confidence, matched },
  });

  // If confidence is low, also suggest escalation but DON'T auto-escalate
  if (confidence < 0.4 && !matched) {
    // Already included in the noMatchResponses answer text
    // Notify admins about low-confidence question
    notifyAllAdminsNewMessage(supabase, conversation_id, message, userId).catch(() => {});
  }

  await supabase.from('support_conversations')
    .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', conversation_id);

  return jsonRes({ success: true, escalated: false });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: notify_agent
// ═══════════════════════════════════════════════════════════════════════════════

async function handleNotifyAgent(body: any): Promise<Response> {
  const supabase = createServiceClient();
  const { conversation_id } = body;

  if (!conversation_id) {
    return jsonRes({ error: 'conversation_id is required' }, 400);
  }

  const { data: conversation, error: convError } = await supabase
    .from('support_conversations')
    .select('*')
    .eq('id', conversation_id)
    .single();

  if (convError || !conversation) throw new Error('Conversation not found');

  // Find agents matching language
  const { data: agents } = await supabase
    .from('support_agents')
    .select('*')
    .contains('languages', [conversation.language])
    .order('is_online', { ascending: false });

  let selectedAgent = agents?.[0];

  if (!selectedAgent) {
    const { data: fallbackAgents } = await supabase
      .from('support_agents')
      .select('*')
      .order('is_online', { ascending: false })
      .limit(1);
    selectedAgent = fallbackAgents?.[0];
  }

  if (!selectedAgent) {
    return jsonRes({ success: false, message: 'No agents available' });
  }

  await supabase.from('support_conversations')
    .update({
      assigned_agent_id: selectedAgent.user_id,
      status: 'assigned',
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation_id);

  if (selectedAgent.notify_email) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('user_id', conversation.user_id)
      .single();

    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    const EMAIL_FROM = Deno.env.get('EMAIL_FROM_ADDRESS') || 'noreply@afrishop.com';

    if (RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: EMAIL_FROM,
            to: selectedAgent.notify_email,
            subject: `[AfriShop Support] New chat from ${profile?.full_name || 'Customer'}`,
            html: `<h2>New Support Chat</h2><p>Customer: ${profile?.full_name || 'Unknown'}</p><p>Email: ${profile?.email || 'N/A'}</p><p>Language: ${conversation.language}</p><p><a href="${Deno.env.get('FRONTEND_BASE_URL') || 'https://afrishop-usa.com'}/admin/support-inbox">Open Support Inbox</a></p>`,
          }),
        });
      } catch (emailError) {
        console.error('Failed to send email notification:', emailError);
      }
    }
  }

  if (selectedAgent.notify_push_token) {
    try {
      const supabaseForInvoke = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
      );
      await supabaseForInvoke.functions.invoke('send-push-notification', {
        body: {
          token: selectedAgent.notify_push_token,
          title: 'New Support Chat',
          body: 'A customer needs assistance',
          data: { conversation_id },
        },
      });
    } catch (pushError) {
      console.error('Failed to send push notification:', pushError);
    }
  }

  return jsonRes({ success: true, assigned_agent_id: selectedAgent.user_id });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ROUTER
// ═══════════════════════════════════════════════════════════════════════════════

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const action = body.action;

    if (!action || typeof action !== 'string') {
      return jsonRes({
        ok: false,
        error: 'Missing "action" field. Supported: start, chat_bot, notify_agent',
      }, 400);
    }

    // Auth gate
    let userId: string | null = null;
    if (action !== 'start' || !body.guest_device_id) {
      const authResult = await getUserFromRequest(req);
      if (authResult instanceof Response) {
        if (action === 'start' && body.guest_device_id) {
          // Guest mode
        } else {
          return authResult;
        }
      } else {
        userId = authResult.userId;
      }
    }

    console.log(`[support-service] action="${action}" userId=${userId || 'guest'}`);

    const { action: _a, ...payload } = body;

    switch (action) {
      case 'start':
        return handleStart(userId, payload);
      case 'chat_bot':
        if (!userId) return jsonRes({ ok: false, error: 'Authentication required' }, 401);
        return handleChatBot(userId, payload, req);
      case 'notify_agent':
        return handleNotifyAgent(payload);
      default:
        return jsonRes({ ok: false, error: `Unknown action "${action}". Supported: start, chat_bot, notify_agent` }, 400);
    }
  } catch (err: any) {
    console.error('[support-service] Unhandled error:', err);
    return jsonRes({ ok: false, error: err.message || 'Internal server error' }, 500);
  }
});
