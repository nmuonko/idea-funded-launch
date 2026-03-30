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
  if (req.method === "OPTIONS") {
    return handleCors();
  }

  try {
    console.log("support-send-message: Request received");
    
    const { user, errorResponse } = await verifyAndGetUser(req);
    if (errorResponse || !user) {
      console.log("support-send-message: Auth failed");
      return errorResponse || new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log("support-send-message: User authenticated:", user.id);

    const body: SendMessageRequest = await req.json();
    const { message, thread_id: providedThreadId } = body;
    
    console.log("support-send-message: Body parsed:", { message: message?.substring(0, 50), providedThreadId });

    if (!message || message.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "Message is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let threadId: string;

    // If thread_id provided, verify ownership
    if (providedThreadId) {
      const { data: verifiedThread } = await supabase
        .from("support_threads")
        .select("id")
        .eq("id", providedThreadId)
        .eq("user_id", user.id)
        .single();

      if (verifiedThread) {
        threadId = verifiedThread.id;
        console.log("support-send-message: Using provided thread:", threadId);
      } else {
        console.log("support-send-message: Provided thread_id not found, will find/create new");
      }
    }
    
    // If no valid thread yet, find existing or create new
    if (!threadId!) {
      console.log("support-send-message: Looking for existing thread for user:", user.id);
      
      const { data: existingThread, error: findError } = await supabase
        .from("support_threads")
        .select("id, status")
        .eq("user_id", user.id)
        .in("status", ["open", "waiting_admin", "waiting_user"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      console.log("support-send-message: Find result:", { existingThread, findError: findError?.message });

      if (existingThread) {
        threadId = existingThread.id;
        console.log("support-send-message: Using existing thread:", threadId);
      } else {
        // Check for resolved thread to reopen
        const { data: resolvedThread } = await supabase
          .from("support_threads")
          .select("id")
          .eq("user_id", user.id)
          .eq("status", "resolved")
          .order("updated_at", { ascending: false })
          .limit(1)
          .single();

        if (resolvedThread) {
          console.log("support-send-message: Reopening resolved thread:", resolvedThread.id);
          await supabase
            .from("support_threads")
            .update({ 
              status: "open", 
              last_message_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq("id", resolvedThread.id);
          
          threadId = resolvedThread.id;
        } else {
          console.log("support-send-message: Creating new thread");
          const { data: newThread, error: threadError } = await supabase
            .from("support_threads")
            .insert({ user_id: user.id, status: "waiting_admin" })
            .select("id")
            .single();

          if (threadError || !newThread) {
            console.error("Failed to create thread:", threadError);
            return new Response(
              JSON.stringify({ error: "Failed to create support thread" }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          threadId = newThread.id;
          console.log("support-send-message: Created new thread:", threadId);
        }
      }
    }

    // Insert user message into thread_messages
    const { error: userMsgError } = await supabase
      .from("thread_messages")
      .insert({
        thread_id: threadId,
        sender_type: "user",
        sender_id: user.id,
        message: message.trim(),
        source: "freeform",
      });

    if (userMsgError) {
      console.error("Failed to insert user message:", userMsgError);
      return new Response(
        JSON.stringify({ error: "Failed to save message" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update thread last_message_at and status
    const { error: updateError } = await supabase
      .from("support_threads")
      .update({ 
        last_message_at: new Date().toISOString(),
        status: "waiting_admin"
      })
      .eq("id", threadId);

    if (updateError) {
      console.error("Failed to update thread:", updateError);
    }

    // Fetch latest messages for the thread
    const { data: messages } = await supabase
      .from("thread_messages")
      .select("id, sender_type, message, source, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    return new Response(
      JSON.stringify({
        success: true,
        thread_id: threadId,
        status: "waiting_admin",
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
