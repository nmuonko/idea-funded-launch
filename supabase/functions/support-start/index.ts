import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('SUPPORT_START_INIT');

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Create service role client to bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Try to get user from authorization header
    let userId: string | null = null;
    const authHeader = req.headers.get('Authorization');
    
    if (authHeader) {
      const supabaseAnon = createClient(
        supabaseUrl,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } }
      );
      
      const { data: { user }, error: userError } = await supabaseAnon.auth.getUser();
      if (!userError && user) {
        userId = user.id;
      }
    }

    // Parse request body for guest_device_id and language
    let guestDeviceId: string | null = null;
    let language: string = 'en';
    try {
      const body = await req.json();
      guestDeviceId = body.guest_device_id || null;
      language = body.language || 'en';
    } catch {
      // No body or invalid JSON - that's fine
    }

    // If no user and no guest device id, return error
    if (!userId && !guestDeviceId) {
      console.log('SUPPORT_START_ERROR: No user or guest device id');
      return new Response(
        JSON.stringify({ ok: false, error: 'Authentication required or provide guest_device_id' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let conversationId: string;
    const isGuest = !userId;

    if (userId) {
      // For authenticated users: find or create conversation
      console.log('SUPPORT_START: Looking for existing conversation for user:', userId);
      
      // Find latest open conversation for this user
      const { data: existingConvo, error: findError } = await supabaseAdmin
        .from('support_conversations')
        .select('id')
        .eq('user_id', userId)
        .in('status', ['bot', 'waiting_agent', 'assigned'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (findError) {
        console.error('SUPPORT_START_ERROR: Failed to find conversation:', findError);
        throw findError;
      }

      if (existingConvo) {
        conversationId = existingConvo.id;
        console.log('SUPPORT_START: Found existing conversation:', conversationId);
      } else {
        // Create new conversation
        const { data: newConvo, error: createError } = await supabaseAdmin
          .from('support_conversations')
          .insert({
            user_id: userId,
            status: 'bot',
            language: 'fr'
          })
          .select('id')
          .single();

        if (createError) {
          console.error('SUPPORT_START_ERROR: Failed to create conversation:', createError);
          throw createError;
        }

        conversationId = newConvo.id;
        console.log('SUPPORT_START: Created new conversation:', conversationId);

        // Language-aware welcome message
        const welcomeMessages: Record<string, string> = {
          en: 'Leave us a message describing your need and an agent will respond as soon as possible.',
          fr: 'Laissez-nous un message décrivant votre besoin et un agent vous répondra dans les plus brefs délais.',
          sw: 'Tuachie ujumbe kuhusu hitaji lako na wakala atajibu haraka iwezekanavyo.',
          ln: 'Tika biso message mpo na mposa na yo mpe agent akozongisela yo noki.',
        };
        const welcomeMsg = welcomeMessages[language] || welcomeMessages.en;

        // Insert system welcome message
        const { error: msgError } = await supabaseAdmin
          .from('support_messages')
          .insert({
            conversation_id: conversationId,
            sender_type: 'bot',
            content: welcomeMsg
          });

        if (msgError) {
          console.error('SUPPORT_START_WARNING: Failed to insert welcome message:', msgError);
          // Don't throw - conversation was created successfully
        }
      }
    } else {
      // Guest user flow - use guest_device_id
      console.log('SUPPORT_START: Guest mode with device:', guestDeviceId);
      
      // For guests, we always create a new conversation (or could store device_id in metadata)
      // Since we don't have a guest_device_id column, we'll just create new conversations
      const { data: newConvo, error: createError } = await supabaseAdmin
        .from('support_conversations')
        .insert({
          status: 'bot',
          language: 'fr'
        })
        .select('id')
        .single();

      if (createError) {
        console.error('SUPPORT_START_ERROR: Failed to create guest conversation:', createError);
        throw createError;
      }

      conversationId = newConvo.id;
      console.log('SUPPORT_START: Created guest conversation:', conversationId);

      // Language-aware welcome message for guests
      const guestWelcomeMessages: Record<string, string> = {
        en: 'Leave us a message describing your need and an agent will respond as soon as possible.',
        fr: 'Laissez-nous un message décrivant votre besoin et un agent vous répondra dans les plus brefs délais.',
        sw: 'Tuachie ujumbe kuhusu hitaji lako na wakala atajibu haraka iwezekanavyo.',
        ln: 'Tika biso message mpo na mposa na yo mpe agent akozongisela yo noki.',
      };
      const guestWelcomeMsg = guestWelcomeMessages[language] || guestWelcomeMessages.en;

      // Insert system welcome message
      await supabaseAdmin
        .from('support_messages')
        .insert({
          conversation_id: conversationId,
          sender_type: 'bot',
          content: guestWelcomeMsg
        });
    }

    console.log('SUPPORT_START_OK', { 
      conversation_id: conversationId, 
      is_guest: isGuest, 
      user_id_present: !!userId 
    });

    return new Response(
      JSON.stringify({ 
        ok: true, 
        conversation_id: conversationId, 
        is_guest: isGuest 
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    console.error('SUPPORT_START_ERROR:', errorMessage);
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
