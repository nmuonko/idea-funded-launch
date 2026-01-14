import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { conversation_id } = await req.json();

    if (!conversation_id) {
      return new Response(
        JSON.stringify({ error: "conversation_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get conversation details
    const { data: conversation, error: convError } = await supabase
      .from("support_conversations")
      .select("*")
      .eq("id", conversation_id)
      .single();

    if (convError || !conversation) {
      throw new Error("Conversation not found");
    }

    // Find available agents who speak the conversation's language
    const { data: agents } = await supabase
      .from("support_agents")
      .select("*")
      .contains("languages", [conversation.language])
      .order("is_online", { ascending: false });

    if (!agents || agents.length === 0) {
      console.log("No agents available for language:", conversation.language);
      
      // Fallback: get any available agent
      const { data: fallbackAgents } = await supabase
        .from("support_agents")
        .select("*")
        .order("is_online", { ascending: false })
        .limit(1);

      if (!fallbackAgents || fallbackAgents.length === 0) {
        console.log("No agents available at all");
        return new Response(
          JSON.stringify({ success: false, message: "No agents available" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Get the best agent (prefer online ones)
    const selectedAgent = agents?.[0];

    if (selectedAgent) {
      // Assign the conversation to this agent
      await supabase
        .from("support_conversations")
        .update({
          assigned_agent_id: selectedAgent.user_id,
          status: "assigned",
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversation_id);

      // Send notification
      if (selectedAgent.notify_email) {
        // Get customer info
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("user_id", conversation.user_id)
          .single();

        const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
        const EMAIL_FROM = Deno.env.get("EMAIL_FROM_ADDRESS") || "noreply@afrishop.com";

        if (RESEND_API_KEY) {
          try {
            await fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${RESEND_API_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                from: EMAIL_FROM,
                to: selectedAgent.notify_email,
                subject: `[AfriShop Support] New chat from ${profile?.full_name || 'Customer'}`,
                html: `
                  <h2>New Support Chat</h2>
                  <p>A customer needs assistance.</p>
                  <ul>
                    <li><strong>Customer:</strong> ${profile?.full_name || 'Unknown'}</li>
                    <li><strong>Email:</strong> ${profile?.email || 'N/A'}</li>
                    <li><strong>Language:</strong> ${conversation.language}</li>
                  </ul>
                  <p><a href="${Deno.env.get("FRONTEND_BASE_URL") || 'https://afrishop-usa.com'}/admin/support-inbox">Open Support Inbox</a></p>
                `,
              }),
            });
            console.log("Email notification sent to agent:", selectedAgent.notify_email);
          } catch (emailError) {
            console.error("Failed to send email notification:", emailError);
          }
        }
      }

      // If agent has push token, send push notification
      if (selectedAgent.notify_push_token) {
        try {
          await supabase.functions.invoke("send-push-notification", {
            body: {
              token: selectedAgent.notify_push_token,
              title: "New Support Chat",
              body: "A customer needs assistance",
              data: { conversation_id },
            },
          });
        } catch (pushError) {
          console.error("Failed to send push notification:", pushError);
        }
      }

      return new Response(
        JSON.stringify({ success: true, assigned_agent_id: selectedAgent.user_id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: false, message: "No agent assigned" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in notify-support-agent:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
