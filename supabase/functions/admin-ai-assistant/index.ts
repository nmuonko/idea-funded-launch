import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Extract and verify JWT token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify token and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user has admin role
    const { data: userRole, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .single();

    if (roleError || !userRole) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { message, conversationHistory } = await req.json();
    const openAIApiKey = Deno.env.get('OPENAI_API_KEY');
    
    if (!openAIApiKey) {
      throw new Error('OpenAI API key not configured');
    }

    // Fetch relevant data to provide context
    const { data: submissions, error: subError } = await supabase
      .from('user_submissions')
      .select('*')
      .eq('payment_status', 'paid')
      .eq('is_draft', false);

    if (subError) throw subError;

    const { data: sessions, error: sessError } = await supabase
      .from('sessions')
      .select('*');

    if (sessError) throw sessError;

    // Calculate statistics
    const totalSubmissions = submissions?.length || 0;
    const textSubmissions = submissions?.filter(s => s.submission_type === 'text').length || 0;
    const voiceSubmissions = submissions?.filter(s => s.submission_type === 'voice').length || 0;
    const avgScore = submissions?.reduce((acc, s) => acc + (s.ai_overall_score || 0), 0) / totalSubmissions || 0;
    const fraudCount = submissions?.filter(s => s.is_suspected_fraud).length || 0;
    
    const countryCounts: Record<string, number> = {};
    submissions?.forEach(s => {
      if (s.country) {
        countryCounts[s.country] = (countryCounts[s.country] || 0) + 1;
      }
    });

    const categoryCounts: Record<string, number> = {};
    submissions?.forEach(s => {
      if (s.category) {
        categoryCounts[s.category] = (categoryCounts[s.category] || 0) + 1;
      }
    });

    // Build context for AI
    const dataContext = `
Current Competition Statistics:
- Total Paid Submissions: ${totalSubmissions}
- Text Submissions: ${textSubmissions}
- Voice Submissions: ${voiceSubmissions}
- Average AI Overall Score: ${avgScore.toFixed(2)}/100
- Suspected Fraud Cases: ${fraudCount}
- Active Sessions: ${sessions?.length || 0}

Submissions by Country:
${Object.entries(countryCounts).map(([country, count]) => `- ${country}: ${count}`).join('\n')}

Submissions by Category:
${Object.entries(categoryCounts).map(([category, count]) => `- ${category}: ${count}`).join('\n')}
`;

    // Build messages array for OpenAI
    const messages = [
      {
        role: 'system',
        content: `You are an AI assistant helping an administrator manage a project competition in the DRC. 
You have access to real-time data about submissions and sessions. 
Be helpful, concise, and provide actionable insights.
When answering questions, reference the specific data provided.

${dataContext}`
      },
      ...conversationHistory.slice(-5), // Include last 5 messages for context
      { role: 'user', content: message }
    ];

    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openAIApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: messages,
        temperature: 0.7,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('OpenAI API error:', errorData);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    return new Response(
      JSON.stringify({ response: aiResponse }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in admin-ai-assistant:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});