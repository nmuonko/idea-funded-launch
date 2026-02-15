import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find tickets that are open or in_progress for more than 24 hours and not escalated
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: ticketsToEscalate, error: fetchError } = await supabase
      .from('support_tickets')
      .select('*')
      .in('status', ['open', 'in_progress'])
      .eq('escalated', false)
      .lt('created_at', twentyFourHoursAgo);

    if (fetchError) {
      console.error('Error fetching tickets:', fetchError);
      throw fetchError;
    }

    console.log(`Found ${ticketsToEscalate?.length || 0} tickets to escalate`);

    if (ticketsToEscalate && ticketsToEscalate.length > 0) {
      // Update tickets to escalated status and set priority to urgent
      const { error: updateError } = await supabase
        .from('support_tickets')
        .update({
          escalated: true,
          escalated_at: new Date().toISOString(),
          priority: 'urgent',
          updated_at: new Date().toISOString(),
        })
        .in('id', ticketsToEscalate.map(t => t.id));

      if (updateError) {
        console.error('Error updating tickets:', updateError);
        throw updateError;
      }

      // Send notification for each escalated ticket
      for (const ticket of ticketsToEscalate) {
        try {
          await supabase.functions.invoke('send-ticket-notification', {
            body: {
              ticketId: ticket.id,
              ticketSubject: ticket.subject,
              type: 'escalated',
            },
          });
        } catch (notifError) {
          console.error(`Failed to send notification for ticket ${ticket.id}:`, notifError);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        escalated: ticketsToEscalate?.length || 0,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Error in escalate-tickets function:', error);
    return new Response(
      JSON.stringify({ error: 'An error occurred while processing tickets' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
