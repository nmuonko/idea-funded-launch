/**
 * support-service — Consolidated Support/Chat Function (INLINED)
 *
 * Actions:
 *   start        — find or create a support conversation
 *   chat_bot     — FAQ-matching chatbot with auto-escalation
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
  en: 'Leave us a message describing your need and an agent will respond as soon as possible.',
  fr: 'Laissez-nous un message décrivant votre besoin et un agent vous répondra dans les plus brefs délais.',
  sw: 'Tuachie ujumbe kuhusu hitaji lako na wakala atajibu haraka iwezekanavyo.',
  ln: 'Tika biso message mpo na mposa na yo mpe agent akozongisela yo noki.',
};

async function handleStart(userId: string | null, body: any): Promise<Response> {
  const supabaseAdmin = createServiceClient();
  const guestDeviceId = body.guest_device_id || null;
  const language = body.language || 'en';

  if (!userId && !guestDeviceId) {
    return jsonRes({ ok: false, error: 'Authentication required or provide guest_device_id' }, 401);
  }

  let conversationId: string;
  const isGuest = !userId;

  if (userId) {
    // Find existing open conversation
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
        content: WELCOME_MESSAGES[language] || WELCOME_MESSAGES.en,
      });
    }
  } else {
    // Guest flow
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
      content: WELCOME_MESSAGES[language] || WELCOME_MESSAGES.en,
    });
  }

  return jsonRes({ ok: true, conversation_id: conversationId, is_guest: isGuest });
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACTION: chat_bot
// ═══════════════════════════════════════════════════════════════════════════════

const faqKnowledge: Record<string, any> = {
  fr: {
    delivery: [
      { q: ['livraison', 'délai', 'quand', 'arriver'], a: 'Les délais de livraison varient de 7 à 21 jours selon la destination. Vous pouvez suivre votre commande dans la section "Mes Commandes".' },
      { q: ['où', 'commande', 'colis', 'suivi'], a: 'Vous pouvez suivre votre commande dans "Mes Commandes". Vous y trouverez le numéro de suivi et le statut actuel.' },
      { q: ['ville', 'livrer', 'kinshasa', 'lubumbashi'], a: 'Nous livrons dans toutes les grandes villes de RDC, principalement Kinshasa et Lubumbashi. Contactez-nous pour les autres villes.' },
    ],
    payment: [
      { q: ['paiement', 'payer', 'mobile money', 'mpesa', 'airtel'], a: 'Nous acceptons Mobile Money (M-Pesa, Airtel Money, Orange Money) et les virements bancaires.' },
      { q: ['échoué', 'erreur', 'problème', 'refusé'], a: 'Si votre paiement a échoué, vérifiez votre solde et réessayez. Si le problème persiste, un agent peut vous aider.' },
      { q: ['reçu', 'confirmation', 'facture'], a: 'Après un paiement réussi, vous recevez un email de confirmation avec les détails de votre commande.' },
    ],
    orders: [
      { q: ['commande', 'statut', 'état'], a: 'Vous pouvez voir le statut de vos commandes dans "Mes Commandes". Les statuts possibles sont: En attente, Payé, En traitement, Expédié, Livré.' },
      { q: ['annuler', 'annulation'], a: 'Pour annuler une commande non encore traitée, contactez notre support. Les commandes déjà expédiées ne peuvent pas être annulées.' },
      { q: ['modifier', 'changer', 'adresse'], a: 'Pour modifier votre commande ou adresse de livraison, contactez-nous rapidement avant l\'expédition.' },
    ],
    refund: [
      { q: ['remboursement', 'rembourser', 'retour'], a: 'Les remboursements sont possibles pour les produits non conformes ou endommagés. Contactez un agent pour initier la procédure.' },
      { q: ['combien', 'temps', 'délai'], a: 'Les remboursements sont traités sous 5-10 jours ouvrables après validation de votre demande.' },
    ],
    default: 'Je ne suis pas sûr de comprendre votre question. Voulez-vous parler à un agent pour une assistance personnalisée?',
  },
  en: {
    delivery: [
      { q: ['delivery', 'time', 'when', 'arrive'], a: 'Delivery times vary from 7 to 21 days depending on destination. You can track your order in "My Orders".' },
      { q: ['where', 'order', 'package', 'track'], a: 'You can track your order in "My Orders". You\'ll find the tracking number and current status there.' },
      { q: ['city', 'deliver', 'kinshasa', 'lubumbashi'], a: 'We deliver to all major cities in DRC, mainly Kinshasa and Lubumbashi. Contact us for other cities.' },
    ],
    payment: [
      { q: ['payment', 'pay', 'mobile money', 'mpesa', 'airtel'], a: 'We accept Mobile Money (M-Pesa, Airtel Money, Orange Money) and bank transfers.' },
      { q: ['failed', 'error', 'problem', 'declined'], a: 'If your payment failed, check your balance and try again. If the problem persists, an agent can help.' },
      { q: ['receipt', 'confirmation', 'invoice'], a: 'After a successful payment, you receive a confirmation email with your order details.' },
    ],
    orders: [
      { q: ['order', 'status', 'state'], a: 'You can see your order status in "My Orders". Possible statuses: Pending, Paid, Processing, Shipped, Delivered.' },
      { q: ['cancel', 'cancellation'], a: 'To cancel an unprocessed order, contact our support. Already shipped orders cannot be cancelled.' },
      { q: ['modify', 'change', 'address'], a: 'To modify your order or delivery address, contact us quickly before shipping.' },
    ],
    refund: [
      { q: ['refund', 'return', 'money back'], a: 'Refunds are possible for non-conforming or damaged products. Contact an agent to initiate the process.' },
      { q: ['how long', 'time', 'delay'], a: 'Refunds are processed within 5-10 business days after your request is validated.' },
    ],
    default: 'I\'m not sure I understand your question. Would you like to speak with an agent for personalized assistance?',
  },
  sw: { default: 'Sijui kujibu swali lako. Je, ungependa kuongea na wakala kwa msaada zaidi?' },
  ln: { default: 'Nayebi te ndenge ya koyanola motuna na yo. Olingi kosolola na agent mpo na lisungi?' },
};

const escalationKeywords: Record<string, string[]> = {
  fr: ['agent', 'humain', 'plainte', 'mécontent', 'arnaque', 'volé', 'urgent', 'avocat', 'remboursement', 'scandale'],
  en: ['agent', 'human', 'complaint', 'unhappy', 'scam', 'stolen', 'urgent', 'lawyer', 'refund', 'scandal'],
  sw: ['wakala', 'mtu', 'malalamiko'],
  ln: ['agent', 'moto', 'nkanda'],
};

function findBestAnswer(message: string, lang: string): { answer: string; confidence: number; shouldEscalate: boolean } {
  const lowerMessage = message.toLowerCase();
  const kb = faqKnowledge[lang] || faqKnowledge.fr;
  const escKeywords = escalationKeywords[lang] || escalationKeywords.fr;

  for (const keyword of escKeywords) {
    if (lowerMessage.includes(keyword)) {
      return { answer: kb.default || faqKnowledge.fr.default, confidence: 0, shouldEscalate: true };
    }
  }

  let bestMatch = { answer: '', score: 0 };
  for (const category of ['delivery', 'payment', 'orders', 'refund'] as const) {
    const items = kb[category];
    if (!items) continue;
    for (const item of items) {
      let score = 0;
      for (const keyword of item.q) {
        if (lowerMessage.includes(keyword)) score += 1;
      }
      if (score > bestMatch.score) bestMatch = { answer: item.a, score };
    }
  }

  if (bestMatch.score >= 1) {
    return { answer: bestMatch.answer, confidence: Math.min(bestMatch.score / 3, 1), shouldEscalate: false };
  }
  return { answer: kb.default || faqKnowledge.fr.default, confidence: 0.3, shouldEscalate: false };
}

const ESCALATION_MESSAGES: Record<string, string> = {
  fr: "Je vous mets en relation avec un agent pour mieux vous aider. Un moment s'il vous plaît...",
  en: "I'm connecting you with an agent to better assist you. One moment please...",
  sw: "Ninakuunganisha na wakala ili kukusaidia vizuri. Subiri kidogo...",
  ln: "Nazali kokangisa yo na agent mpo na kosalisa yo malamu. Zela moke...",
};

async function handleChatBot(userId: string, body: any, req: Request): Promise<Response> {
  const supabase = createServiceClient();
  const { conversation_id, message, language = 'fr' } = body;

  if (!conversation_id || !message) {
    return jsonRes({ error: 'conversation_id and message are required' }, 400);
  }

  // Verify conversation ownership
  const { data: conversation, error: convError } = await supabase
    .from('support_conversations')
    .select('user_id')
    .eq('id', conversation_id)
    .single();

  if (convError || !conversation) {
    return jsonRes({ error: 'Conversation not found' }, 404);
  }
  if (conversation.user_id !== userId) {
    return jsonRes({ error: 'Forbidden - not your conversation' }, 403);
  }

  const { answer, confidence, shouldEscalate } = findBestAnswer(message, language);

  // Insert bot response
  await supabase.from('support_messages').insert({
    conversation_id,
    sender_type: 'bot',
    content: answer,
    meta: { confidence, shouldEscalate },
  });

  if (shouldEscalate || confidence < 0.5) {
    await supabase.from('support_messages').insert({
      conversation_id,
      sender_type: 'bot',
      content: ESCALATION_MESSAGES[language] || ESCALATION_MESSAGES.fr,
    });
    await supabase.from('support_conversations')
      .update({ status: 'waiting_agent', updated_at: new Date().toISOString() })
      .eq('id', conversation_id);
    return jsonRes({ success: true, escalated: true });
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
    // Fallback: any agent
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

  // Assign conversation
  await supabase.from('support_conversations')
    .update({
      assigned_agent_id: selectedAgent.user_id,
      status: 'assigned',
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation_id);

  // Send email notification
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

  // Send push notification
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

    // Auth gate: get user (support-start allows optional auth for guests)
    let userId: string | null = null;
    if (action !== 'start' || !body.guest_device_id) {
      const authResult = await getUserFromRequest(req);
      if (authResult instanceof Response) {
        if (action === 'start' && body.guest_device_id) {
          // Guest mode - continue without auth
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
