import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify admin auth
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check admin role
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    if (!roleData) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { actionId, decision, modifiedContent } = await req.json();

    if (!actionId || !decision) {
      return new Response(
        JSON.stringify({ error: 'Missing actionId or decision' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch the action
    const { data: action, error: actionError } = await supabase
      .from('ai_action_queue')
      .select('*')
      .eq('id', actionId)
      .single();

    if (actionError || !action) {
      return new Response(
        JSON.stringify({ error: 'Action not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (decision === 'reject') {
      // Update action status to rejected
      await supabase
        .from('ai_action_queue')
        .update({
          status: 'rejected',
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', actionId);

      return new Response(
        JSON.stringify({ success: true, status: 'rejected' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Handle approval and execution
    let executionResult = null;

    switch (action.action_type) {
      case 'escalation': {
        // Escalate the ticket
        const { error: escalateError } = await supabase
          .from('support_tickets')
          .update({
            escalated: true,
            escalated_at: new Date().toISOString(),
            priority: 'urgent',
            updated_at: new Date().toISOString(),
          })
          .eq('id', action.target_id);

        if (escalateError) throw escalateError;

        // Send notification
        try {
          await supabase.functions.invoke('send-ticket-notification', {
            body: {
              ticketId: action.target_id,
              type: 'escalated',
            },
          });
        } catch (notifError) {
          console.error('Failed to send escalation notification:', notifError);
        }

        executionResult = { action: 'ticket_escalated', ticketId: action.target_id };
        break;
      }

      case 'ticket_response': {
        // Insert the response as a ticket message
        const responseText = modifiedContent || action.ai_decision?.suggestedResponse;

        const { error: messageError } = await supabase
          .from('ticket_messages')
          .insert({
            ticket_id: action.target_id,
            user_id: user.id,
            message: responseText,
            is_admin: true,
          });

        if (messageError) throw messageError;

        // Update ticket status to in_progress
        await supabase
          .from('support_tickets')
          .update({
            status: 'in_progress',
            updated_at: new Date().toISOString(),
          })
          .eq('id', action.target_id);

        executionResult = { action: 'response_sent', ticketId: action.target_id };
        break;
      }

      case 'cart_recovery': {
        // Get prediction details
        const predictionId = action.ai_decision?.predictionId;

        if (predictionId) {
          const { data: prediction } = await supabase
            .from('cart_recovery_predictions')
            .select('*')
            .eq('id', predictionId)
            .single();

          if (prediction) {
            // Send recovery email
            try {
              await supabase.functions.invoke('send-abandoned-cart-emails', {
                body: {
                  orderId: action.target_id,
                  subject: modifiedContent?.subject || prediction.personalized_subject,
                  body: modifiedContent?.body || prediction.personalized_body,
                  discountPercent: prediction.suggested_discount_percent,
                },
              });

              // Mark as sent
              await supabase
                .from('cart_recovery_predictions')
                .update({ sent_at: new Date().toISOString() })
                .eq('id', predictionId);

              executionResult = { action: 'recovery_email_sent', orderId: action.target_id };
            } catch (emailError) {
              console.error('Failed to send recovery email:', emailError);
              throw emailError;
            }
          }
        }
        break;
      }

      default:
        executionResult = { action: 'approved_no_execution', type: action.action_type };
    }

    // Update action status
    await supabase
      .from('ai_action_queue')
      .update({
        status: 'approved',
        reviewed_by: user.id,
        reviewed_at: new Date().toISOString(),
        executed_at: new Date().toISOString(),
        ai_decision: {
          ...action.ai_decision,
          ...(modifiedContent ? { modifiedContent } : {}),
          executionResult,
        },
      })
      .eq('id', actionId);

    return new Response(
      JSON.stringify({
        success: true,
        status: 'approved',
        executionResult,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in execute-ai-action:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
