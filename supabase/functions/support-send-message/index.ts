import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handleCorsPreflightRequest } from "../_shared/http.ts";
import { verifyAndGetUser } from "../_shared/auth.ts";

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
    return handleCorsPreflightRequest();
  }

  try {
    // Verify user authentication
    const { user, errorResponse } = await verifyAndGetUser(req);
    if (errorResponse || !user) {
      return errorResponse || new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body: SendMessageRequest = await req.json();
    const { message, language = "fr", thread_id: providedThreadId } = body;

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

    // Find or create an open thread for this user
    let threadId: string;

    // If thread_id provided, verify it belongs to user
    if (providedThreadId) {
      const { data: verifiedThread } = await supabase
        .from("support_threads")
        .select("id")
        .eq("id", providedThreadId)
        .eq("user_id", user.id)
        .single();

      if (verifiedThread) {
        threadId = verifiedThread.id;
      } else {
        return new Response(
          JSON.stringify({ error: "Thread not found or access denied" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // Find existing open thread or create new
      const { data: existingThread } = await supabase
        .from("support_threads")
        .select("id")
        .eq("user_id", user.id)
        .in("status", ["open", "waiting_admin", "waiting_user"])
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (existingThread) {
        threadId = existingThread.id;
      } else {
        // Create new thread
        const { data: newThread, error: threadError } = await supabase
          .from("support_threads")
          .insert({ user_id: user.id, status: "open" })
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
      }
    }

    // Insert user message into support_messages
    const { error: userMsgError } = await supabase
      .from("support_messages")
      .insert({
        thread_id: threadId,
        sender_type: "user",
        sender_id: user.id,
        message: message.trim(),
        source: "user",
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
      newStatus = "open"; // Keep open, user might have more questions
    } else {
      // No match found - fallback message
      aiMessage = language === "en"
        ? "I couldn't find an instant answer for your question. Please leave your message and an agent will respond shortly."
        : "Je n'ai pas trouvé une réponse instantanée. Laissez votre message et un agent vous répondra prochainement.";
      aiSource = "fallback";
      newStatus = "waiting_admin";
    }

    // Insert AI response
    const { error: aiMsgError } = await supabase
      .from("support_messages")
      .insert({
        thread_id: threadId,
        sender_type: "ai",
        sender_id: null,
        message: aiMessage,
        source: aiSource,
        faq_id: faqId,
      });

    if (aiMsgError) {
      console.error("Failed to insert AI message:", aiMsgError);
      // Continue anyway, user message was saved
    }

    // Update thread status and last_message_at
    const { error: updateError } = await supabase
      .from("support_threads")
      .update({
        status: newStatus,
        last_message_at: new Date().toISOString(),
      })
      .eq("id", threadId);

    if (updateError) {
      console.error("Failed to update thread:", updateError);
    }

    // Fetch latest messages for the thread
    const { data: messages } = await supabase
      .from("support_messages")
      .select("id, sender_type, sender_id, message, source, faq_id, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    return new Response(
      JSON.stringify({
        success: true,
        thread_id: threadId,
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
