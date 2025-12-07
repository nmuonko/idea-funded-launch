import { Resend } from "https://esm.sh/resend@4.0.0";

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
}

export interface SendEmailResult {
  success: boolean;
  id?: string;
  error?: string;
}

// Singleton Resend client
let resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (!resendClient) {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      throw new Error("[Email] RESEND_API_KEY environment variable is not set. Email sending will fail.");
    }
    resendClient = new Resend(apiKey);
  }
  return resendClient;
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
 * Send an email using Resend
 * @param opts Email options
 * @returns Result with success status and optional error
 */
export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const { to, subject, html, text, from = DEFAULT_FROM_EMAIL, category = "test", replyTo } = opts;

  // Generate plain text fallback if not provided
  const plainText = text || stripHtml(html);

  // Normalize recipients to array
  const recipients = Array.isArray(to) ? to : [to];

  console.log(`[Email] Sending ${category} email to ${recipients.join(", ")} - Subject: "${subject}"`);

  try {
    const resend = getResendClient();

    const emailPayload: any = {
      from,
      to: recipients,
      subject,
      html,
      text: plainText,
    };

    if (replyTo) {
      emailPayload.reply_to = replyTo;
    }

    const response = await resend.emails.send(emailPayload);

    if (response.error) {
      console.error(`[Email] Resend API error for ${category}:`, response.error);
      return { success: false, error: response.error.message };
    }

    console.log(`[Email] Successfully sent ${category} email, ID: ${response.data?.id}`);
    return { success: true, id: response.data?.id };
  } catch (error: any) {
    console.error(`[Email] Failed to send ${category} email to ${recipients.join(", ")}:`, error.message);
    return { success: false, error: error.message };
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
