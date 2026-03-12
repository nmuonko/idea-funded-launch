/**
 * Email Helper - SDK-free implementation using Resend REST API
 * Replaces esm.sh/resend dependency to avoid bundle timeout
 */

// Default sender configuration
export const DEFAULT_FROM_EMAIL = "AfriShop USA <nkadimisha@afrishop-usa.com>";
export const ADMIN_EMAIL = "nkadimisha@afrishop-usa.com";

// Email categories for tracking and logging
export type EmailCategory =
  | "test"
  | "user_welcome"
  | "password_reset"
  | "application_submitted"
  | "payment_success"
  | "payment_failed"
  | "order_confirmation"
  | "order_status_update"
  | "order_shipped"
  | "order_delivered"
  | "shipping_notification"
  | "quote_request"
  | "quote_response"
  | "ticket_notification"
  | "cart_recovery"
  | "admin_notification"
  | "fraud_alert"
  | "customer_email";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  category?: EmailCategory;
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

// Strip HTML tags for plain text fallback
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Send an email using Resend REST API directly
 * No SDK dependency - uses native fetch
 */
export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const { to, subject, html, text, from = DEFAULT_FROM_EMAIL, category = "test", replyTo, headers: customHeaders } = opts;

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.error("[Email] RESEND_API_KEY not set");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  // Generate plain text fallback if not provided
  const plainText = text || stripHtml(html);

  // Normalize recipients to array
  const recipients = Array.isArray(to) ? to : [to];

  console.log(`[Email] Sending ${category} email to ${recipients.join(", ")} - Subject: "${subject}"`);

  try {
    const payload: Record<string, unknown> = {
      from,
      to: recipients,
      subject,
      html,
      text: plainText,
    };

    if (replyTo) {
      payload.reply_to = replyTo;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      const errMsg = data?.message || data?.error?.message || `HTTP ${res.status}`;
      console.error(`[Email] Resend API error for ${category}:`, errMsg);
      return { success: false, error: errMsg };
    }

    console.log(`[Email] Successfully sent ${category} email, ID: ${data.id}`);
    return { success: true, id: data.id };
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[Email] Failed to send ${category} email to ${recipients.join(", ")}:`, errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * Send email without blocking - fire and forget
 * Logs errors but doesn't throw
 */
export function sendEmailAsync(opts: SendEmailOptions): void {
  sendEmail(opts).catch((err) => {
    console.error(`[Email] Async send failed for ${opts.category || "unknown"}:`, err);
  });
}

/**
 * Send admin notification email
 */
export async function notifyAdmin(subject: string, html: string, category: EmailCategory = "admin_notification"): Promise<SendEmailResult> {
  return sendEmail({
    to: ADMIN_EMAIL,
    subject: `[Admin] ${subject}`,
    html,
    category,
  });
}
