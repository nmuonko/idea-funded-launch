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
    const { command, userEmail } = await req.json();

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Use GPT to interpret the command and map it to actions
    const systemPrompt = `You are an AI assistant that helps manage the AfriFund application database. 
You can perform the following operations:
1. Update site_content table (keys: homepage_hero_title, homepage_hero_subtitle, how_it_works_intro, results_page_intro, footer_contact_text, etc.)
2. Update sessions table (fields: is_active, target_applicants, deadline_datetime, name, description, status)
3. Insert/update winners table (fields: winner_name, project_name, country, award_amount, year, testimonial_text, short_quote, image_url, display_order, is_published, session_id)
4. Update feature_flags table (keys: enable_voice_submission, show_public_results)
5. Update theme_settings table (fields: primary_color, secondary_color, accent_color, hero_background_style, button_style, typography_preset)

When given a command, respond with a JSON object that specifies the action to take:
{
  "action": "update_site_content" | "update_session" | "create_winner" | "update_winner" | "update_feature_flag" | "update_theme" | "query_data" | "confirm_required",
  "table": string,
  "data": object,
  "where": object (for updates),
  "confirmation_message": string (only for destructive actions),
  "response_message": string (what to tell the user)
}

For destructive actions (like deleting all winners), set action to "confirm_required" and provide a confirmation_message.
Always provide a friendly response_message explaining what you will do or have done.

Examples:
- "Change the homepage title to 'Test Title'" → {"action": "update_site_content", "data": {"key": "homepage_hero_title", "value": "Test Title"}, "response_message": "I'll update the homepage title to 'Test Title'."}
- "Set active session target to 800" → {"action": "update_session", "where": {"is_active": true}, "data": {"target_applicants": 800}, "response_message": "I'll set the active session target to 800 applicants."}
- "Add a winner named John from DRC" → {"action": "create_winner", "data": {...}, "response_message": "I'll create a winner record for John."}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: command }
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const actionPlan = JSON.parse(aiResponse.choices[0].message.content);

    console.log('Action plan:', actionPlan);

    // Handle confirmation required
    if (actionPlan.action === 'confirm_required') {
      return new Response(
        JSON.stringify({
          success: false,
          requiresConfirmation: true,
          confirmationMessage: actionPlan.confirmation_message,
          responseMessage: actionPlan.response_message
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let result;
    let actionDescription = actionPlan.response_message;

    // Execute the action
    switch (actionPlan.action) {
      case 'update_site_content': {
        const { data, error } = await supabase
          .from('site_content')
          .upsert({
            key: actionPlan.data.key,
            value: actionPlan.data.value,
            updated_at: new Date().toISOString()
          }, { onConflict: 'key' });
        
        if (error) throw error;
        result = { success: true, data };
        break;
      }

      case 'update_session': {
        const { data, error } = await supabase
          .from('sessions')
          .update(actionPlan.data)
          .match(actionPlan.where || {});
        
        if (error) throw error;
        result = { success: true, data };
        break;
      }

      case 'create_winner': {
        const { data, error } = await supabase
          .from('winners')
          .insert(actionPlan.data)
          .select();
        
        if (error) throw error;
        result = { success: true, data };
        break;
      }

      case 'update_winner': {
        const { data, error } = await supabase
          .from('winners')
          .update(actionPlan.data)
          .match(actionPlan.where || {});
        
        if (error) throw error;
        result = { success: true, data };
        break;
      }

      case 'update_feature_flag': {
        const { data, error } = await supabase
          .from('feature_flags')
          .upsert({
            key: actionPlan.data.key,
            value: actionPlan.data.value,
            updated_at: new Date().toISOString()
          }, { onConflict: 'key' });
        
        if (error) throw error;
        result = { success: true, data };
        break;
      }

      case 'update_theme': {
        const { data, error } = await supabase
          .from('theme_settings')
          .update(actionPlan.data)
          .eq('id', actionPlan.where?.id || (await supabase.from('theme_settings').select('id').limit(1).single()).data?.id);
        
        if (error) throw error;
        result = { success: true, data };
        break;
      }

      case 'query_data': {
        // For read-only queries
        result = { success: true, message: 'Query functionality coming soon' };
        break;
      }

      default:
        throw new Error(`Unknown action: ${actionPlan.action}`);
    }

    // Log the action
    await supabase
      .from('admin_ai_logs')
      .insert({
        admin_email: userEmail,
        action_description: actionDescription,
        details_json: actionPlan,
        success: true
      });

    return new Response(
      JSON.stringify({
        success: true,
        responseMessage: actionPlan.response_message,
        result
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in ai-command-center function:', error);
    
    // Try to log the error
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      const { userEmail } = await req.json();
      await supabase
        .from('admin_ai_logs')
        .insert({
          admin_email: userEmail || 'unknown',
          action_description: 'Error occurred',
          error_message: (error as Error).message || String(error),
          success: false
        });
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }

    return new Response(
      JSON.stringify({ 
        success: false,
        error: (error as Error).message || 'An error occurred processing your command'
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});