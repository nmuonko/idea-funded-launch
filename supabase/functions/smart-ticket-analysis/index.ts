import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const AUTO_EXECUTE_THRESHOLD = 0.85;

interface TicketAnalysis {
  sentiment: 'angry' | 'frustrated' | 'neutral' | 'happy';
  topic: 'order' | 'payment' | 'shipping' | 'product' | 'account' | 'general';
  urgencyScore: number; // 1-10
  suggestedResponse: string;
  shouldEscalate: boolean;
  escalationReason?: string;
  confidence: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { ticketId, analyzeAll } = await req.json();

    // Fetch ticket(s) to analyze
    let ticketsQuery = supabase
      .from('support_tickets')
      .select(`
        *,
        profiles:user_id (
          full_name,
          email,
          country
        )
      `)
      .is('ai_analyzed_at', null);

    if (ticketId) {
      ticketsQuery = ticketsQuery.eq('id', ticketId);
    } else if (!analyzeAll) {
      ticketsQuery = ticketsQuery.in('status', ['open', 'in_progress']).limit(10);
    }

    const { data: tickets, error: ticketsError } = await ticketsQuery;

    if (ticketsError) {
      console.error('Error fetching tickets:', ticketsError);
      throw ticketsError;
    }

    if (!tickets || tickets.length === 0) {
      return new Response(
        JSON.stringify({ success: true, analyzed: 0, message: 'No tickets to analyze' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results = [];

    for (const ticket of tickets) {
      try {
        // Fetch customer context (order history, total spent, past tickets)
        const { data: customerOrders } = await supabase
          .from('orders')
          .select('id, status, total_usd, created_at')
          .eq('user_id', ticket.user_id)
          .order('created_at', { ascending: false })
          .limit(5);

        const { data: pastTickets } = await supabase
          .from('support_tickets')
          .select('id, status, priority, rating')
          .eq('user_id', ticket.user_id)
          .neq('id', ticket.id)
          .limit(5);

        const totalSpent = customerOrders?.reduce((sum, o) => sum + (o.total_usd || 0), 0) || 0;
        const isVip = totalSpent > 500 || (customerOrders?.length || 0) >= 5;

        // Build AI prompt
        const customerContext = `
Customer: ${ticket.profiles?.full_name || 'Unknown'}
Email: ${ticket.profiles?.email || 'Unknown'}
Country: ${ticket.profiles?.country || 'Unknown'}
VIP Status: ${isVip ? 'Yes (high-value customer)' : 'No'}
Total Orders: ${customerOrders?.length || 0}
Total Spent: $${totalSpent.toFixed(2)}
Past Tickets: ${pastTickets?.length || 0}
`;

        const prompt = `Analyze this support ticket and provide a JSON response.

TICKET:
Subject: ${ticket.subject}
Description: ${ticket.description}
Priority: ${ticket.priority}
Status: ${ticket.status}
Created: ${ticket.created_at}
${ticket.order_id ? `Related Order ID: ${ticket.order_id}` : ''}

CUSTOMER CONTEXT:
${customerContext}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "sentiment": "angry" | "frustrated" | "neutral" | "happy",
  "topic": "order" | "payment" | "shipping" | "product" | "account" | "general",
  "urgencyScore": 1-10,
  "suggestedResponse": "A professional, empathetic response draft in the customer's likely language (French for DRC/African countries, English otherwise). Keep it under 200 words.",
  "shouldEscalate": true/false,
  "escalationReason": "reason if shouldEscalate is true",
  "confidence": 0.0-1.0
}

Consider:
- VIP customers should get higher urgency
- Payment/fraud issues are always high urgency
- Angry sentiment + payment issue = immediate escalation
- Match response language to customer's country`;

        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${lovableApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: 'You are an expert customer support analyst. Analyze tickets and provide structured responses.' },
              { role: 'user', content: prompt }
            ],
          }),
        });

        if (!aiResponse.ok) {
          console.error(`AI API error for ticket ${ticket.id}:`, await aiResponse.text());
          continue;
        }

        const aiData = await aiResponse.json();
        const content = aiData.choices?.[0]?.message?.content;

        if (!content) {
          console.error(`No AI content for ticket ${ticket.id}`);
          continue;
        }

        // Parse AI response
        let analysis: TicketAnalysis;
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error('No JSON found');
          analysis = JSON.parse(jsonMatch[0]);
        } catch (parseError) {
          console.error(`Failed to parse AI response for ticket ${ticket.id}:`, parseError);
          continue;
        }

        // Update ticket with AI analysis
        const { error: updateError } = await supabase
          .from('support_tickets')
          .update({
            ai_sentiment: analysis.sentiment,
            ai_topic: analysis.topic,
            ai_urgency_score: analysis.urgencyScore,
            ai_suggested_response: analysis.suggestedResponse,
            ai_analyzed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', ticket.id);

        if (updateError) {
          console.error(`Error updating ticket ${ticket.id}:`, updateError);
          continue;
        }

        // Handle escalation
        if (analysis.shouldEscalate && analysis.confidence >= AUTO_EXECUTE_THRESHOLD) {
          // Auto-escalate high-confidence decisions
          await supabase
            .from('support_tickets')
            .update({
              escalated: true,
              escalated_at: new Date().toISOString(),
              priority: 'urgent',
            })
            .eq('id', ticket.id);

          // Log the auto-action
          await supabase
            .from('ai_action_queue')
            .insert({
              action_type: 'escalation',
              target_id: ticket.id,
              target_type: 'support_ticket',
              ai_decision: {
                action: 'escalate',
                reason: analysis.escalationReason,
                sentiment: analysis.sentiment,
                urgencyScore: analysis.urgencyScore,
              },
              confidence_score: analysis.confidence,
              status: 'auto_executed',
              executed_at: new Date().toISOString(),
            });

          console.log(`Auto-escalated ticket ${ticket.id} (confidence: ${analysis.confidence})`);
        } else if (analysis.shouldEscalate) {
          // Queue for admin review
          await supabase
            .from('ai_action_queue')
            .insert({
              action_type: 'escalation',
              target_id: ticket.id,
              target_type: 'support_ticket',
              ai_decision: {
                action: 'escalate',
                reason: analysis.escalationReason,
                sentiment: analysis.sentiment,
                urgencyScore: analysis.urgencyScore,
                suggestedResponse: analysis.suggestedResponse,
              },
              confidence_score: analysis.confidence,
              status: 'pending_review',
            });

          console.log(`Queued escalation for review: ticket ${ticket.id} (confidence: ${analysis.confidence})`);
        }

        // Queue response suggestion for admin review (never auto-send)
        if (analysis.suggestedResponse) {
          await supabase
            .from('ai_action_queue')
            .insert({
              action_type: 'ticket_response',
              target_id: ticket.id,
              target_type: 'support_ticket',
              ai_decision: {
                action: 'respond',
                suggestedResponse: analysis.suggestedResponse,
                sentiment: analysis.sentiment,
                topic: analysis.topic,
              },
              confidence_score: analysis.confidence,
              status: 'pending_review',
            });
        }

        results.push({
          ticketId: ticket.id,
          analysis,
          autoExecuted: analysis.shouldEscalate && analysis.confidence >= AUTO_EXECUTE_THRESHOLD,
        });

      } catch (ticketError) {
        console.error(`Error analyzing ticket ${ticket.id}:`, ticketError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        analyzed: results.length,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in smart-ticket-analysis:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
