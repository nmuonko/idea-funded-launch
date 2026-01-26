import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// FAQ knowledge base
const faqKnowledge = {
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
  sw: {
    default: 'Sijui kujibu swali lako. Je, ungependa kuongea na wakala kwa msaada zaidi?',
  },
  ln: {
    default: 'Nayebi te ndenge ya koyanola motuna na yo. Olingi kosolola na agent mpo na lisungi?',
  },
};

// Keywords that trigger escalation
const escalationKeywords = {
  fr: ['agent', 'humain', 'plainte', 'mécontent', 'arnaque', 'volé', 'urgent', 'avocat', 'remboursement', 'scandale'],
  en: ['agent', 'human', 'complaint', 'unhappy', 'scam', 'stolen', 'urgent', 'lawyer', 'refund', 'scandal'],
  sw: ['wakala', 'mtu', 'malalamiko'],
  ln: ['agent', 'moto', 'nkanda'],
};

function findBestAnswer(message: string, lang: string): { answer: string; confidence: number; shouldEscalate: boolean } {
  const lowerMessage = message.toLowerCase();
  const kb = faqKnowledge[lang as keyof typeof faqKnowledge] || faqKnowledge.fr;
  
  // Check for escalation keywords
  const escKeywords = escalationKeywords[lang as keyof typeof escalationKeywords] || escalationKeywords.fr;
  for (const keyword of escKeywords) {
    if (lowerMessage.includes(keyword)) {
      return { 
        answer: kb.default || faqKnowledge.fr.default, 
        confidence: 0, 
        shouldEscalate: true 
      };
    }
  }

  // Search through FAQ categories
  let bestMatch = { answer: '', score: 0 };
  
  for (const category of ['delivery', 'payment', 'orders', 'refund'] as const) {
    const items = (kb as any)[category];
    if (!items) continue;
    
    for (const item of items) {
      let score = 0;
      for (const keyword of item.q) {
        if (lowerMessage.includes(keyword)) {
          score += 1;
        }
      }
      if (score > bestMatch.score) {
        bestMatch = { answer: item.a, score };
      }
    }
  }

  if (bestMatch.score >= 1) {
    return { 
      answer: bestMatch.answer, 
      confidence: Math.min(bestMatch.score / 3, 1), 
      shouldEscalate: false 
    };
  }

  // Use AI for more complex questions
  return { 
    answer: (kb as any).default || faqKnowledge.fr.default, 
    confidence: 0.3, 
    shouldEscalate: false 
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Verify authentication
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error("support-chat-bot: Missing Authorization header");
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Get authenticated user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      console.error("support-chat-bot: Invalid auth token", authError?.message);
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { conversation_id, message, language = 'fr' } = await req.json();

    if (!conversation_id || !message) {
      return new Response(
        JSON.stringify({ error: "conversation_id and message are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Verify conversation ownership BEFORE inserting messages
    const { data: conversation, error: convError } = await supabase
      .from('support_conversations')
      .select('user_id')
      .eq('id', conversation_id)
      .single();

    if (convError || !conversation) {
      console.error("support-chat-bot: Conversation not found", conversation_id);
      return new Response(
        JSON.stringify({ error: 'Conversation not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (conversation.user_id !== user.id) {
      console.error("support-chat-bot: User does not own conversation", { userId: user.id, conversationUserId: conversation.user_id });
      return new Response(
        JSON.stringify({ error: 'Forbidden - not your conversation' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Find answer
    const { answer, confidence, shouldEscalate } = findBestAnswer(message, language);

    // Insert bot response
    await supabase
      .from("support_messages")
      .insert({
        conversation_id,
        sender_type: "bot",
        content: answer,
        meta: { confidence, shouldEscalate },
      });

    // Update conversation if should escalate
    if (shouldEscalate || confidence < 0.5) {
      const escalationMessages: Record<string, string> = {
        fr: "Je vous mets en relation avec un agent pour mieux vous aider. Un moment s'il vous plaît...",
        en: "I'm connecting you with an agent to better assist you. One moment please...",
        sw: "Ninakuunganisha na wakala ili kukusaidia vizuri. Subiri kidogo...",
        ln: "Nazali kokangisa yo na agent mpo na kosalisa yo malamu. Zela moke...",
      };

      // Insert escalation message
      await supabase
        .from("support_messages")
        .insert({
          conversation_id,
          sender_type: "bot",
          content: escalationMessages[language] || escalationMessages.fr,
        });

      // Update conversation status
      await supabase
        .from("support_conversations")
        .update({ 
          status: "waiting_agent",
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversation_id);

      return new Response(
        JSON.stringify({ success: true, escalated: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update last_message_at
    await supabase
      .from("support_conversations")
      .update({ 
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversation_id);

    return new Response(
      JSON.stringify({ success: true, escalated: false }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in support-chat-bot:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
