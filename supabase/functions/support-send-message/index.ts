import { createClient } from "@supabase/supabase-js";
import { handleCors, getCorsHeaders } from "../_shared/http.ts";
import { verifyAndGetUser } from "../_shared/auth.ts";

const corsHeaders = getCorsHeaders();

interface SendMessageRequest {
  message: string;
  language?: "fr" | "en";
  thread_id?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handleCors();
  }

  try {
    console.log("support-send-message: Request received");
    
    // Verify user authentication
    const { user, errorResponse } = await verifyAndGetUser(req);
    if (errorResponse || !user) {
      console.log("support-send-message: Auth failed");
      return errorResponse || new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log("support-send-message: User authenticated:", user.id);

    // Parse request body
    const body: SendMessageRequest = await req.json();
    const { message, language = "fr", thread_id: providedThreadId } = body;
    
    console.log("support-send-message: Body parsed:", { message: message?.substring(0, 50), language, providedThreadId });

    if (!message || message.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Message is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client with service role for full access
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find or create an open conversation for this user
    let conversationId: string;

    // If thread_id provided, try to find it
    if (providedThreadId) {
      const { data: verifiedConv } = await supabase
        .from("support_conversations")
        .select("id")
        .eq("id", providedThreadId)
        .eq("user_id", user.id)
        .single();

      if (verifiedConv) {
        conversationId = verifiedConv.id;
        console.log("support-send-message: Using provided conversation:", conversationId);
      } else {
        console.log("support-send-message: Provided thread_id not found, will find/create new");
      }
    }
    
    // If no valid conversation yet, find existing or create new
    if (!conversationId) {
      console.log("support-send-message: Looking for existing conversation for user:", user.id);
      
      // First check for open conversations
      const { data: existingConv, error: findError } = await supabase
        .from("support_conversations")
        .select("id, status")
        .eq("user_id", user.id)
        .in("status", ["waiting_agent", "assigned"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      console.log("support-send-message: Find result:", { existingConv, findError: findError?.message });

      if (existingConv) {
        conversationId = existingConv.id;
        console.log("support-send-message: Using existing conversation:", conversationId);
      } else {
        // Check for closed conversation to reopen
        const { data: closedConv } = await supabase
          .from("support_conversations")
          .select("id")
          .eq("user_id", user.id)
          .eq("status", "closed")
          .order("updated_at", { ascending: false })
          .limit(1)
          .single();

        if (closedConv) {
          // Reopen the closed conversation
          console.log("support-send-message: Reopening closed conversation:", closedConv.id);
          await supabase
            .from("support_conversations")
            .update({ 
              status: "waiting_agent", 
              assigned_agent_id: null,
              updated_at: new Date().toISOString()
            })
            .eq("id", closedConv.id);
          
          conversationId = closedConv.id;
        } else {
          // Create new conversation - status is waiting_agent so admins see it immediately
          console.log("support-send-message: Creating new conversation");
          const { data: newConv, error: convError } = await supabase
            .from("support_conversations")
            .insert({ user_id: user.id, status: "waiting_agent", language })
            .select("id")
            .single();

          if (convError || !newConv) {
            console.error("Failed to create conversation:", convError);
            return new Response(
              JSON.stringify({ error: "Failed to create support conversation" }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          conversationId = newConv.id;
          console.log("support-send-message: Created new conversation:", conversationId);
        }
      }
    }

    // Insert user message into support_messages
    const { error: userMsgError } = await supabase
      .from("support_messages")
      .insert({
        conversation_id: conversationId,
        sender_type: "user",
        content: message.trim(),
        meta: { user_id: user.id },
      });

    if (userMsgError) {
      console.error("Failed to insert user message:", userMsgError);
      return new Response(
        JSON.stringify({ error: "Failed to save message" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update conversation last_message_at
    const { error: updateError } = await supabase
      .from("support_conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversationId);

    if (updateError) {
      console.error("Failed to update conversation:", updateError);
    }

    // Fetch latest messages for the conversation
    const { data: messages } = await supabase
      .from("support_messages")
      .select("id, sender_type, content, meta, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    return new Response(
      JSON.stringify({
        success: true,
        thread_id: conversationId,
        status: "waiting_agent",
        messages: messages || [],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("support-send-message error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
