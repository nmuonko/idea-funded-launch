import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

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

    const url = new URL(req.url);
    const status = url.searchParams.get('status') || 'pending_review';
    const actionType = url.searchParams.get('action_type');
    const limit = parseInt(url.searchParams.get('limit') || '50');

    // Fetch AI actions
    let query = supabase
      .from('ai_action_queue')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    if (actionType) {
      query = query.eq('action_type', actionType);
    }

    const { data: actions, error: actionsError } = await query;

    if (actionsError) {
      throw actionsError;
    }

    // Enrich with target details
    const enrichedActions = await Promise.all(
      (actions || []).map(async (action) => {
        let targetDetails = null;

        if (action.target_type === 'support_ticket') {
          const { data: ticket } = await supabase
            .from('support_tickets')
            .select(`
              id, subject, status, priority, created_at,
              profiles:user_id (full_name, email)
            `)
            .eq('id', action.target_id)
            .single();
          targetDetails = ticket;
        } else if (action.target_type === 'order') {
          const { data: order } = await supabase
            .from('orders')
            .select(`
              id, status, total_usd, created_at,
              profiles:user_id (full_name, email)
            `)
            .eq('id', action.target_id)
            .single();
          targetDetails = order;
        }

        return { ...action, targetDetails };
      })
    );

    // Get summary stats
    const { data: stats } = await supabase
      .from('ai_action_queue')
      .select('status, action_type')
      .in('status', ['pending_review', 'approved', 'rejected', 'auto_executed']);

    const summary = {
      pending_review: 0,
      approved: 0,
      rejected: 0,
      auto_executed: 0,
      by_type: {} as Record<string, number>,
    };

    stats?.forEach((s) => {
      summary[s.status as keyof typeof summary]++;
      summary.by_type[s.action_type] = (summary.by_type[s.action_type] || 0) + 1;
    });

    return new Response(
      JSON.stringify({
        success: true,
        actions: enrichedActions,
        summary,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in get-ai-actions-for-review:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
