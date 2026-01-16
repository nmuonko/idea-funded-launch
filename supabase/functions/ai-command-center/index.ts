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

    // Get user email from authenticated user, not from request body
    const userEmail = user.email;
    const { command } = await req.json();

    // Input validation - prevent prompt injection and excessive API usage
    const MAX_COMMAND_LENGTH = 2000;
    if (!command || typeof command !== 'string') {
      return new Response(
        JSON.stringify({ error: 'Command is required and must be a string' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (command.length > MAX_COMMAND_LENGTH) {
      return new Response(
        JSON.stringify({ error: `Command exceeds maximum length of ${MAX_COMMAND_LENGTH} characters` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Sanitize command - remove potential injection patterns
    const sanitizedCommand = command
      .replace(/\x00/g, '') // Remove null bytes
      .trim();

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    
    if (!OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not configured');
    }

    // Enhanced system prompt with more capabilities
    const systemPrompt = `You are an AI assistant that helps manage the AfriFund application database. 
You can perform the following operations:

1. **Session Management**: 
   - Update sessions table (fields: is_active, target_applicants, deadline_datetime, name, status)
   - Set active session (set is_active=true for one session, false for all others)
   - Change session status: 'open', 'closed', 'results_published'
   - IMPORTANT: For "set_active_session" action, put the session identifier in "where" field (e.g., {"name": "Session 1"})
   - IMPORTANT: If command includes both setting active session AND changing status (like "close applications"), include both in the data field

2. **Winners Management**:
   - Insert new winners (fields: winner_name, project_name, country, award_amount, year, session_id, is_published)
   - Update winners (modify award_amount, publish/unpublish winners via is_published field)
   - Delete winners

3. **Content Management**:
   - Update site_content table (keys: homepage_hero_title, homepage_hero_subtitle, how_it_works_intro, results_page_intro, footer_contact_text, etc.)
   - Update page content on homepage, results page, contact page, footer

4. **Feature Flags**:
   - Update feature_flags table (keys: enable_voice_submission, show_public_results, applications_enabled, etc.)
   - Enable/disable features via boolean values

5. **Theme Settings**:
   - Update theme_settings table (fields: primary_color, secondary_color, accent_color, hero_background_style, button_style, typography_preset)
   - Change colors (must be valid HSL format like hsl(220, 85%, 30%))

When given a command in English or French, respond with a JSON object that specifies the action to take:
{
  "action": "update_site_content" | "update_session" | "set_active_session" | "create_winner" | "update_winner" | "delete_winner" | "update_feature_flag" | "update_theme" | "query_data" | "confirm_required",
  "table": string,
  "data": object (for set_active_session, can include status changes like {"status": "closed"}),
  "where": object (REQUIRED for set_active_session and update_* actions - specifies which record(s) to target),
  "confirmation_message": string (only for destructive actions),
  "response_message": string (what to tell the user)
}

CRITICAL: Always include "where" clause for these actions:
- set_active_session: use where to identify session (e.g., {"name": "Session 1"} or {"name": "Session 2"})
- update_session: use where to identify which session (e.g., {"is_active": true} or {"name": "Session 1"})
- update_winner: use where to identify which winner(s) (e.g., {"session_id": "xxx"} or {"id": "xxx"})

For destructive actions (like deleting records or bulk updates), set action to "confirm_required" and provide a confirmation_message.
Always provide a friendly response_message explaining what you will do or have done.

Examples:
- "Change the homepage title to 'Test Title'" → {"action": "update_site_content", "data": {"key": "homepage_hero_title", "value": "Test Title"}, "response_message": "I'll update the homepage title to 'Test Title'."}
- "Set Session 1 as active" → {"action": "set_active_session", "where": {"name": "Session 1"}, "data": {}, "response_message": "I'll set Session 1 as the active session."}
- "Set Session 2 as active and close applications" → {"action": "set_active_session", "where": {"name": "Session 2"}, "data": {"status": "closed"}, "response_message": "I'll set Session 2 as the active session and close applications."}
- "Close applications for active session" → {"action": "update_session", "where": {"is_active": true}, "data": {"status": "closed"}, "response_message": "I'll close applications for the active session."}
- "Add a winner named John from DRC with project Solar Power, award $1000" → {"action": "create_winner", "data": {"winner_name": "John", "country": "DRC", "project_name": "Solar Power", "award_amount": 1000, "year": 2025}, "response_message": "I'll create a winner record for John."}
- "Publish all winners for active session" → {"action": "update_winner", "where": {"is_published": false}, "data": {"is_published": true}, "response_message": "I'll publish all unpublished winners."}
- "Change deadline to December 25, 2025 at 7:00 AM" → {"action": "update_session", "where": {"is_active": true}, "data": {"deadline_datetime": "2025-12-25T07:00:00Z"}, "response_message": "I'll update the deadline for the active session."}

Support both English and French commands (e.g., "Fermer les candidatures" = "Close applications", "Activer Session 1" = "Set Session 1 as active")`;

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
          { role: 'user', content: sanitizedCommand }
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
        if (!actionPlan.where || Object.keys(actionPlan.where).length === 0) {
          throw new Error('UPDATE requires a WHERE clause. Please specify which session to update (e.g., by session name or is_active=true)');
        }
        const { data, error } = await supabase
          .from('sessions')
          .update(actionPlan.data)
          .match(actionPlan.where);
        
        if (error) throw error;
        result = { success: true, data };
        break;
      }

      case 'set_active_session': {
        if (!actionPlan.where || Object.keys(actionPlan.where).length === 0) {
          throw new Error('Please specify which session to activate (e.g., by name "Session 1" or by id)');
        }
        
        // First, get the session to activate
        const { data: targetSession, error: findError } = await supabase
          .from('sessions')
          .select('id, name')
          .match(actionPlan.where)
          .single();
        
        if (findError || !targetSession) {
          throw new Error(`Could not find session with ${JSON.stringify(actionPlan.where)}. Available sessions might be "Session 1" or "Session 2".`);
        }

        // Deactivate all sessions
        await supabase
          .from('sessions')
          .update({ is_active: false })
          .neq('id', '00000000-0000-0000-0000-000000000000');

        // Prepare update data - start with is_active true
        const updateData: any = { is_active: true };
        
        // If actionPlan.data contains additional fields (like status), include them
        if (actionPlan.data && Object.keys(actionPlan.data).length > 0) {
          Object.assign(updateData, actionPlan.data);
        }

        // Then activate the specified session (and optionally update other fields)
        const { data, error } = await supabase
          .from('sessions')
          .update(updateData)
          .eq('id', targetSession.id);
        
        if (error) throw error;
        
        let message = `Activated session: ${targetSession.name}`;
        if (updateData.status) {
          message += ` and set status to '${updateData.status}'`;
        }
        
        result = { success: true, data, message };
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
        if (!actionPlan.where || Object.keys(actionPlan.where).length === 0) {
          throw new Error('UPDATE requires a WHERE clause. Please specify which winner(s) to update (e.g., by session_id or winner id)');
        }
        const { data, error } = await supabase
          .from('winners')
          .update(actionPlan.data)
          .match(actionPlan.where);
        
        if (error) throw error;
        result = { success: true, data };
        break;
      }

      case 'delete_winner': {
        const { data, error } = await supabase
          .from('winners')
          .delete()
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
        // Get the first theme_settings record (there should only be one)
        const { data: themeRecord } = await supabase
          .from('theme_settings')
          .select('id')
          .limit(1)
          .single();
        
        if (!themeRecord) {
          throw new Error('No theme settings found. Please create a theme settings record first.');
        }
        
        const { data, error } = await supabase
          .from('theme_settings')
          .update(actionPlan.data)
          .eq('id', themeRecord.id);
        
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
    
    // Create a friendly error message
    let friendlyMessage = (error as Error).message || 'An error occurred processing your command';
    
    // Add specific guidance for common errors
    if (friendlyMessage.includes('UPDATE requires a WHERE clause')) {
      friendlyMessage += '. Try specifying which record to update, for example: "Update Session 1 deadline" or "Update active session status".';
    } else if (friendlyMessage.includes('Could not find session')) {
      friendlyMessage += '. Please check the session name or ID and try again.';
    }
    
    // Try to log the error - use authenticated user email if available
    try {
      const authHeader = req.headers.get('Authorization');
      if (authHeader) {
        const token = authHeader.replace('Bearer ', '');
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);
        
        const { data: { user } } = await supabase.auth.getUser(token);
        await supabase
          .from('admin_ai_logs')
          .insert({
            admin_email: user?.email || 'unknown',
            action_description: 'Command failed',
            error_message: friendlyMessage,
            success: false
          });
      }
    } catch (logError) {
      console.error('Failed to log error:', logError);
    }

    return new Response(
      JSON.stringify({ 
        success: false,
        error: friendlyMessage
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
