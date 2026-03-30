import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface MessageRequest {
  thread_id?: string;
  content: string;
  language?: string;
}

serve(async (req) => {
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

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      console.log(`[${requestId}] Invalid token:`, authError?.message);
      return new Response(
        JSON.stringify({ success: false, code: 'INVALID_TOKEN', message: 'Invalid or expired session' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[${requestId}] User authenticated:`, user.id);

    let body: MessageRequest;
    try {
      body = await req.json();
    } catch (parseErr) {
      return new Response(
        JSON.stringify({ success: false, code: 'INVALID_JSON', message: 'Invalid request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    let threadId = body.thread_id;

    if (!threadId) {
      // Check for existing active thread
      const { data: existingThread } = await supabase
        .from('support_threads')
        .select('id')
        .eq('user_id', user.id)
        .in('status', ['open', 'waiting_admin', 'waiting_user'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (existingThread) {
        threadId = existingThread.id;
        console.log(`[${requestId}] Using existing thread:`, threadId);
      } else {
        // Create new thread
        const { data: newThread, error: createError } = await supabase
          .from('support_threads')
          .insert({
            user_id: user.id,
            status: 'waiting_admin',
            last_message_at: new Date().toISOString(),
          })
          .select('id')
          .single();

        if (createError) {
          console.error(`[${requestId}] Failed to create thread:`, createError.message);
          return new Response(
            JSON.stringify({ success: false, code: 'CREATE_FAILED', message: 'Failed to create thread' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        threadId = newThread.id;
        console.log(`[${requestId}] Created new thread:`, threadId);
      }
    } else {
      // Verify user owns this thread
      const { data: ownedThread, error: verifyError } = await supabase
        .from('support_threads')
        .select('id')
        .eq('id', threadId)
        .eq('user_id', user.id)
        .single();

      if (verifyError || !ownedThread) {
        console.log(`[${requestId}] User does not own thread:`, threadId);
        return new Response(
          JSON.stringify({ success: false, code: 'NOT_AUTHORIZED', message: 'You do not have access to this thread' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Insert the message
    const { data: message, error: insertError } = await supabase
      .from('thread_messages')
      .insert({
        thread_id: threadId,
        message: content,
        sender_type: 'user',
        sender_id: user.id,
        source: 'freeform',
      })
      .select('id, message, created_at, sender_type')
      .single();

    if (insertError) {
      console.error(`[${requestId}] Failed to insert message:`, insertError.message, insertError.code, insertError.details);
      return new Response(
        JSON.stringify({ 
          success: false, 
          code: 'INSERT_FAILED', 
          message: 'Failed to send message',
          debug: {
            error_code: insertError.code,
            error_hint: insertError.hint || null,
            thread_id: threadId,
          },
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update thread last_message_at and status
    await supabase
      .from('support_threads')
      .update({ 
        last_message_at: new Date().toISOString(),
        status: 'waiting_admin',
      })
      .eq('id', threadId);

    console.log(`[${requestId}] Message sent successfully:`, message.id);

    return new Response(
      JSON.stringify({
        success: true,
        message: {
          id: message.id,
          thread_id: threadId,
          content: message.message,
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
