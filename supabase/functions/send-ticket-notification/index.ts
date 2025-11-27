import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationRequest {
  ticketId?: string;
  ticketSubject: string;
  type: 'created' | 'updated' | 'admin_reply' | 'customer_reply' | 'status_change';
  newStatus?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { ticketId, ticketSubject, type, newStatus }: NotificationRequest = await req.json();

    console.log("Processing ticket notification:", { ticketId, type });

    const adminEmail = Deno.env.get("ADMIN_NOTIFICATION_EMAIL") || "admin@afrishop.com";
    const fromEmail = Deno.env.get("EMAIL_FROM_ADDRESS") || "AfriShop Support <support@afrishop.com>";

    let emailResponse;

    if (type === 'created') {
      // Notify admin about new ticket
      emailResponse = await resend.emails.send({
        from: fromEmail,
        to: [adminEmail],
        subject: `New Support Ticket: ${ticketSubject}`,
        html: `
          <h1>New Support Ticket</h1>
          <p><strong>Subject:</strong> ${ticketSubject}</p>
          <p>A new support ticket has been created. Please check the admin panel to respond.</p>
          <p><a href="${Deno.env.get("FRONTEND_BASE_URL")}/admin/support">View in Admin Panel</a></p>
        `,
      });
    } else if (type === 'customer_reply' && ticketId) {
      // Notify admin about customer reply
      emailResponse = await resend.emails.send({
        from: fromEmail,
        to: [adminEmail],
        subject: `Customer Reply: ${ticketSubject}`,
        html: `
          <h1>Customer Reply</h1>
          <p><strong>Ticket:</strong> ${ticketSubject}</p>
          <p>The customer has replied to their support ticket.</p>
          <p><a href="${Deno.env.get("FRONTEND_BASE_URL")}/admin/support">View in Admin Panel</a></p>
        `,
      });
    } else if (type === 'admin_reply' && ticketId) {
      // Notify customer about admin reply
      const { data: ticket } = await supabase
        .from('support_tickets')
        .select('user_id')
        .eq('id', ticketId)
        .single();

      if (ticket) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('user_id', ticket.user_id)
          .single();

        const { data: { user } } = await supabase.auth.admin.getUserById(ticket.user_id);

        if (user?.email) {
          emailResponse = await resend.emails.send({
            from: fromEmail,
            to: [user.email],
            subject: `Support Update: ${ticketSubject}`,
            html: `
              <h1>Support Team Reply</h1>
              <p>Our support team has replied to your ticket: <strong>${ticketSubject}</strong></p>
              <p><a href="${Deno.env.get("FRONTEND_BASE_URL")}/support">View your ticket</a></p>
            `,
          });
        }
      }
    } else if (type === 'status_change' && ticketId) {
      // Notify customer about status change
      const { data: ticket } = await supabase
        .from('support_tickets')
        .select('user_id')
        .eq('id', ticketId)
        .single();

      if (ticket) {
        const { data: { user } } = await supabase.auth.admin.getUserById(ticket.user_id);

        if (user?.email) {
          emailResponse = await resend.emails.send({
            from: fromEmail,
            to: [user.email],
            subject: `Ticket Status Updated: ${ticketSubject}`,
            html: `
              <h1>Ticket Status Update</h1>
              <p>Your support ticket status has been updated to: <strong>${newStatus}</strong></p>
              <p><strong>Ticket:</strong> ${ticketSubject}</p>
              <p><a href="${Deno.env.get("FRONTEND_BASE_URL")}/support">View your ticket</a></p>
            `,
          });
        }
      }
    }

    console.log("Notification email sent:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, emailResponse }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error sending notification:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
