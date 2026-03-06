import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ROLE_PERMISSIONS: Record<string, string[]> = {
  super_admin: ['orders', 'payments', 'users', 'analytics', 'support', 'carts', 'settings'],
  finance: ['payments', 'analytics'],
  operations: ['orders', 'carts', 'shipping'],
  support: ['support', 'orders'],
};

// Input validation constants
const MAX_QUERY_LENGTH = 1500;
const MAX_HISTORY_LENGTH = 10;
const MAX_MESSAGE_LENGTH = 1500;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: roleData } = await supabase
      .from('user_roles')
      .select('admin_role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    if (!roleData) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create service role client for rate limiting
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Rate limiting - 50 requests per hour per admin user
    const rateLimitKey = `admin-ai-assistant:${user.id}`;
    const { data: rateLimitResult, error: rateLimitError } = await supabaseAdmin
      .rpc('check_rate_limit', {
        p_key: rateLimitKey,
        p_max_requests: 50,
        p_window_seconds: 3600
      });

    if (rateLimitError) {
      console.error('[admin-ai-assistant] Rate limit check error:', rateLimitError);
    } else if (rateLimitResult && !rateLimitResult.allowed) {
      console.warn('[admin-ai-assistant] Rate limit exceeded for user:', user.id);
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later (limit: 50 requests/hour).' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminRole = roleData.admin_role || 'support';
    const permissions = ROLE_PERMISSIONS[adminRole] || [];
    const { query, conversationHistory } = await req.json();

    // Input validation for query
    if (!query || typeof query !== 'string') {
      return new Response(JSON.stringify({ error: 'query is required and must be a string' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    if (query.length > MAX_QUERY_LENGTH) {
      return new Response(JSON.stringify({ error: `query exceeds maximum length of ${MAX_QUERY_LENGTH} characters` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Enhanced sanitization - remove null bytes, control characters, and suspicious patterns
    const sanitizedQuery = query
      .replace(/\x00/g, '') // Remove null bytes
      .replace(/[\x01-\x1F\x7F]/g, '') // Remove control characters
      .replace(/\bsystem\s*:/gi, '[filtered]:') // Filter system: prefix attempts
      .replace(/\bassistant\s*:/gi, '[filtered]:') // Filter assistant: prefix attempts
      .replace(/\bignore\s+(previous|above|all)\s+instructions?\b/gi, '[filtered]') // Filter common injection patterns
      .trim();
    
    // Validate conversation history structure
    let validatedHistory: Array<{role: string; content: string}> = [];
    if (conversationHistory !== undefined) {
      if (!Array.isArray(conversationHistory)) {
        return new Response(JSON.stringify({ error: 'conversationHistory must be an array' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      // Limit history length and validate each message with enhanced sanitization
      validatedHistory = conversationHistory
        .slice(-MAX_HISTORY_LENGTH)
        .filter((msg: any) => 
          msg && 
          typeof msg === 'object' && 
          typeof msg.role === 'string' && 
          ['user', 'assistant', 'system'].includes(msg.role) &&
          typeof msg.content === 'string' &&
          msg.content.length <= MAX_MESSAGE_LENGTH
        )
        .map((msg: any) => ({
          role: msg.role,
          content: msg.content
            .replace(/\x00/g, '') // Remove null bytes
            .replace(/[\x01-\x1F\x7F]/g, '') // Remove control characters
            .replace(/\bsystem\s*:/gi, '[filtered]:') // Filter system: prefix attempts
            .replace(/\bassistant\s*:/gi, '[filtered]:') // Filter assistant: prefix attempts
            .replace(/\bignore\s+(previous|above|all)\s+instructions?\b/gi, '[filtered]') // Filter common injection patterns
            .trim()
            .slice(0, MAX_MESSAGE_LENGTH)
        }));
    }

    let dataContext = '';

    if (permissions.includes('orders')) {
      const { data: orders } = await supabase.from('orders').select('id, status, total_usd, payment_verified_at').limit(100);
      const paidOrders = orders?.filter(o => o.payment_verified_at)?.length || 0;
      const revenue = orders?.filter(o => o.payment_verified_at)?.reduce((sum, o) => sum + (o.total_usd || 0), 0) || 0;
      dataContext += `\n## Orders: ${orders?.length || 0} total, ${paidOrders} paid, $${revenue.toFixed(2)} revenue`;
    }

    if (permissions.includes('carts')) {
      const { data: carts } = await supabase.from('orders').select('id, total_usd').in('status', ['DRAFT', 'PENDING_PAYMENT']);
      const cartValue = carts?.reduce((sum, c) => sum + (c.total_usd || 0), 0) || 0;
      dataContext += `\n## Carts: ${carts?.length || 0} active, $${cartValue.toFixed(2)} total value`;
    }

    if (permissions.includes('support')) {
      const { data: tickets } = await supabase.from('support_tickets').select('id, status, priority').limit(50);
      const urgentTickets = tickets?.filter(t => t.priority === 'urgent' || t.priority === 'high')?.length || 0;
      dataContext += `\n## Support: ${tickets?.length || 0} tickets, ${urgentTickets} urgent/high priority`;
    }

    const restrictedAreas = ['orders', 'payments', 'users', 'analytics', 'support', 'carts'].filter(a => !permissions.includes(a));
    if (restrictedAreas.length > 0) {
      dataContext += `\n## Restricted: ${restrictedAreas.join(', ')} - cannot access`;
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: `You are an AfriShop admin assistant. Role: ${adminRole}. ${dataContext}` },
          ...validatedHistory,
          { role: 'user', content: sanitizedQuery }
        ],
      }),
    });

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      if (aiResponse.status === 402) return new Response(JSON.stringify({ error: 'Payment required - please add funds' }), { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    return new Response(JSON.stringify({ response: aiData.choices?.[0]?.message?.content || 'No response', role: adminRole, permissions }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[admin-ai-assistant] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
