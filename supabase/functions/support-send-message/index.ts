import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCors, getCorsHeaders } from "../_shared/http.ts";
import { verifyAndGetUser } from "../_shared/auth.ts";

const corsHeaders = getCorsHeaders();

interface SendMessageRequest {
  message: string;
  language?: "fr" | "en";
  thread_id?: string;
}

interface FaqMatch {
  id: string;
  question: string;
  answer: string;
  tags: string[];
  trigger_phrases: string[];
  priority: number;
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

    // Find or create an open conversation for this user (using support_conversations table)
    let conversationId: string;

    // If thread_id provided, try to find it - but don't fail if not found
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
        // Provided ID not found in support_conversations - fall through to find/create
        console.log("support-send-message: Provided thread_id not found in support_conversations, will find/create new");
      }
    }
    
    // If no valid conversation yet, find existing or create new
    if (!conversationId) {
      // Find existing open conversation or create new
      console.log("support-send-message: Looking for existing conversation for user:", user.id);
      
      const { data: existingConv, error: findError } = await supabase
        .from("support_conversations")
        .select("id, status")
        .eq("user_id", user.id)
        .in("status", ["bot", "waiting_agent", "assigned"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      console.log("support-send-message: Find result:", { existingConv, findError: findError?.message });

      if (existingConv) {
        conversationId = existingConv.id;
        console.log("support-send-message: Using existing conversation:", conversationId);
      } else {
        // Create new conversation
        console.log("support-send-message: Creating new conversation");
        const { data: newConv, error: convError } = await supabase
          .from("support_conversations")
          .insert({ user_id: user.id, status: "bot", language })
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

    // Try to match FAQ
    const { data: faqMatch, error: faqError } = await supabase
      .rpc("match_faq", { user_text: message, lang: language }) as { data: FaqMatch[] | null; error: unknown };

    let aiMessage: string;
    let aiSource: string;
    let faqId: string | null = null;
    let newStatus: string;

    if (faqMatch && faqMatch.length > 0) {
      // Found a FAQ match
      const match = faqMatch[0];
      aiMessage = match.answer;
      aiSource = "faq_kb";
      faqId = match.id;
      newStatus = "bot"; // Keep in bot status, user might have more questions
    } else {
      // No match found - fallback message
      aiMessage = language === "en"
        ? "I couldn't find an instant answer for your question. Please leave your message and an agent will respond shortly."
        : "Je n'ai pas trouvé une réponse instantanée. Laissez votre message et un agent vous répondra prochainement.";
      aiSource = "fallback";
      newStatus = "waiting_agent"; // Switch to waiting_agent for admin to see
    }

    // Insert AI response
    const { error: aiMsgError } = await supabase
      .from("support_messages")
      .insert({
        conversation_id: conversationId,
        sender_type: "ai",
        content: aiMessage,
        meta: { source: aiSource, faq_id: faqId },
      });

    if (aiMsgError) {
      console.error("Failed to insert AI message:", aiMsgError);
      // Continue anyway, user message was saved
    }

    // Update conversation status and last_message_at
    const { error: updateError } = await supabase
      .from("support_conversations")
      .update({
        status: newStatus,
        last_message_at: new Date().toISOString(),
      })
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
        status: newStatus,
        faq_matched: faqId !== null,
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
