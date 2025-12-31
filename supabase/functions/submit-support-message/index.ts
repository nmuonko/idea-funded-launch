import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface MessageRequest {
  conversation_id?: string;
  content: string;
  language?: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();
  console.log(`[${requestId}] submit-support-message: Start`);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      console.error(`[${requestId}] Missing environment variables`);
      return new Response(
        JSON.stringify({ success: false, code: 'CONFIG_ERROR', message: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Extract bearer token for user auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      console.log(`[${requestId}] Missing auth header`);
      return new Response(
        JSON.stringify({ success: false, code: 'AUTH_REQUIRED', message: 'Authentication required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Verify user token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.log(`[${requestId}] Invalid token:`, authError?.message);
      return new Response(
        JSON.stringify({ success: false, code: 'INVALID_TOKEN', message: 'Invalid or expired session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[${requestId}] User authenticated:`, user.id);

    // Parse request body
    let body: MessageRequest;
    try {
      body = await req.json();
    } catch (parseErr) {
      return new Response(
        JSON.stringify({ success: false, code: 'INVALID_JSON', message: 'Invalid request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate content
    const content = body.content?.trim();
    if (!content || content.length === 0) {
      return new Response(
        JSON.stringify({ success: false, code: 'EMPTY_MESSAGE', message: 'Message content is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (content.length > 5000) {
      return new Response(
        JSON.stringify({ success: false, code: 'MESSAGE_TOO_LONG', message: 'Message exceeds maximum length of 5000 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const language = body.language || 'fr';
    let conversationId = body.conversation_id;

    // If no conversation_id provided, find or create one for this user
    if (!conversationId) {
      // Check for existing active conversation
      const { data: existingConversation } = await supabase
        .from('support_conversations')
        .select('id')
        .eq('user_id', user.id)
        .in('status', ['bot', 'waiting', 'active'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (existingConversation) {
        conversationId = existingConversation.id;
        console.log(`[${requestId}] Using existing conversation:`, conversationId);
      } else {
        // Create new conversation
        const { data: newConversation, error: createError } = await supabase
          .from('support_conversations')
          .insert({
            user_id: user.id,
            status: 'bot',
            language: language,
            last_message_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (createError) {
          console.error(`[${requestId}] Failed to create conversation:`, createError.message);
          return new Response(
            JSON.stringify({ success: false, code: 'CREATE_FAILED', message: 'Failed to create conversation' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        conversationId = newConversation.id;
        console.log(`[${requestId}] Created new conversation:`, conversationId);
      }
    } else {
      // Verify user owns this conversation
      const { data: ownedConversation, error: verifyError } = await supabase
        .from('support_conversations')
        .select('id')
        .eq('id', conversationId)
        .eq('user_id', user.id)
        .single();

      if (verifyError || !ownedConversation) {
        console.log(`[${requestId}] User does not own conversation:`, conversationId);
        return new Response(
          JSON.stringify({ success: false, code: 'NOT_AUTHORIZED', message: 'You do not have access to this conversation' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Insert the message
    const { data: message, error: insertError } = await supabase
      .from('support_messages')
      .insert({
        conversation_id: conversationId,
        content: content,
        sender_type: 'user',
        meta: { user_id: user.id },
      })
      .select('id, content, created_at, sender_type')
      .single();

    if (insertError) {
      console.error(`[${requestId}] Failed to insert message:`, insertError.message);
      return new Response(
        JSON.stringify({ success: false, code: 'INSERT_FAILED', message: 'Failed to send message' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update conversation last_message_at
    await supabase
      .from('support_conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', conversationId);

    console.log(`[${requestId}] Message sent successfully:`, message.id);

    return new Response(
      JSON.stringify({
        success: true,
        message: {
          id: message.id,
          conversation_id: conversationId,
          content: message.content,
          sender_type: message.sender_type,
          created_at: message.created_at,
        },
        requestId,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error(`[${requestId}] Unexpected error:`, error?.message || error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        code: 'INTERNAL_ERROR', 
        message: 'An unexpected error occurred',
        requestId,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
