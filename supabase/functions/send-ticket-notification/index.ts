import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { sendEmail, DEFAULT_FROM_EMAIL, ADMIN_EMAIL } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationRequest {
  ticketId?: string;
  ticketSubject: string;
  type: 'created' | 'updated' | 'admin_reply' | 'customer_reply' | 'status_change' | 'escalated';
  newStatus?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { ticketId, ticketSubject, type, newStatus }: NotificationRequest = await req.json();

    console.log("[send-ticket-notification] Processing:", { ticketId, type });

    const adminEmail = Deno.env.get("ADMIN_NOTIFICATION_EMAIL") || ADMIN_EMAIL;
    const frontendUrl = Deno.env.get("FRONTEND_BASE_URL") || "https://afrishop-usa.com";
    
    let result;

    if (type === 'created') {
      result = await sendEmail({
        to: adminEmail,
        subject: `New Support Ticket: ${ticketSubject}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">New Support Ticket</h1>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              <p><strong>Subject:</strong> ${ticketSubject}</p>
              <p>A new support ticket has been created. Please check the admin panel to respond.</p>
              <p><a href="${frontendUrl}/admin/support" style="background: #1e3a5f; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">View in Admin Panel</a></p>
            </div>
          </div>
        `,
        category: "ticket_notification",
      });
    } else if (type === 'customer_reply' && ticketId) {
      result = await sendEmail({
        to: adminEmail,
        subject: `Customer Reply: ${ticketSubject}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">Customer Reply</h1>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              <p><strong>Ticket:</strong> ${ticketSubject}</p>
              <p>The customer has replied to their support ticket.</p>
              <p><a href="${frontendUrl}/admin/support" style="background: #1e3a5f; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">View in Admin Panel</a></p>
            </div>
          </div>
        `,
        category: "ticket_notification",
      });
    } else if (type === 'admin_reply' && ticketId) {
      const { data: ticket } = await supabase
        .from('support_tickets')
        .select('user_id')
        .eq('id', ticketId)
        .single();

      if (ticket) {
        const { data: { user } } = await supabase.auth.admin.getUserById(ticket.user_id);
        if (user?.email) {
          result = await sendEmail({
            to: user.email,
            subject: `Support Update: ${ticketSubject}`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 20px; text-align: center;">
                  <h1 style="color: white; margin: 0;">Support Team Reply</h1>
                </div>
                <div style="padding: 30px; background: #f9fafb;">
                  <p>Our support team has replied to your ticket: <strong>${ticketSubject}</strong></p>
                  <p><a href="${frontendUrl}/support" style="background: #1e3a5f; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">View your ticket</a></p>
                </div>
              </div>
            `,
            category: "ticket_notification",
          });
        }
      }
    } else if (type === 'status_change' && ticketId) {
      const { data: ticket } = await supabase
        .from('support_tickets')
        .select('user_id')
        .eq('id', ticketId)
        .single();

      if (ticket) {
        const { data: { user } } = await supabase.auth.admin.getUserById(ticket.user_id);
        if (user?.email) {
          result = await sendEmail({
            to: user.email,
            subject: `Ticket Status Updated: ${ticketSubject}`,
            html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); padding: 20px; text-align: center;">
                  <h1 style="color: white; margin: 0;">Ticket Status Update</h1>
                </div>
                <div style="padding: 30px; background: #f9fafb;">
                  <p>Your support ticket status has been updated to: <strong>${newStatus}</strong></p>
                  <p><strong>Ticket:</strong> ${ticketSubject}</p>
                  <p><a href="${frontendUrl}/support" style="background: #1e3a5f; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">View your ticket</a></p>
                </div>
              </div>
            `,
            category: "ticket_notification",
          });
        }
      }
    } else if (type === 'escalated' && ticketId) {
      result = await sendEmail({
        to: adminEmail,
        subject: `🚨 URGENT: Ticket Escalated - ${ticketSubject}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #dc2626 0%, #ef4444 100%); padding: 20px; text-align: center;">
              <h1 style="color: white; margin: 0;">⚠️ Support Ticket Escalated</h1>
            </div>
            <div style="padding: 30px; background: #f9fafb;">
              <p>A support ticket has been escalated due to being open for more than 24 hours:</p>
              <p><strong>Subject:</strong> ${ticketSubject}</p>
              <p><strong>Ticket ID:</strong> ${ticketId}</p>
              <p style="color: #dc2626; font-weight: bold;">This ticket now requires urgent attention from senior support staff.</p>
              <p><a href="${frontendUrl}/admin/support" style="background: #dc2626; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">View Ticket</a></p>
            </div>
          </div>
        `,
        category: "ticket_notification",
      });
    }

    console.log("[send-ticket-notification] Result:", result);

    return new Response(
      JSON.stringify({ success: result?.success || false, id: result?.id }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("[send-ticket-notification] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
