import { sendEmail } from "../_shared/email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const LOGO_URL = `${SUPABASE_URL}/storage/v1/object/public/email-assets/afrishop-logo.png`;

function buildEmailHtml(): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AfriShop — Connexion simplifiée</title>
</head>
<body style="margin:0;padding:0;background-color:#f7f7f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7f7f7;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <!-- Logo -->
          <tr>
            <td align="center" style="padding:32px 40px 16px 40px;">
              <img src="${LOGO_URL}" alt="AfriShop" width="160" style="display:block;max-width:160px;height:auto;" />
            </td>
          </tr>
          <!-- French Section -->
          <tr>
            <td style="padding:16px 40px 8px 40px;">
              <h1 style="margin:0 0 16px 0;font-size:22px;color:#1a1a1a;font-weight:700;">Connexion simplifiée</h1>
              <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#333333;">Bonjour,</p>
              <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#333333;">Bonne nouvelle ! Vous pouvez maintenant vous connecter à AfriShop directement avec votre email et mot de passe — sans avoir besoin de vérifier votre email au préalable.</p>
              <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#333333;">Si vous aviez des difficultés à vous connecter, essayez à nouveau maintenant. Tout devrait fonctionner parfaitement.</p>
            </td>
          </tr>
          <!-- Divider -->
          <tr>
            <td style="padding:8px 40px;">
              <hr style="border:none;border-top:1px solid #e5e5e5;margin:0;" />
            </td>
          </tr>
          <!-- English Section -->
          <tr>
            <td style="padding:8px 40px 24px 40px;">
              <h2 style="margin:0 0 12px 0;font-size:18px;color:#1a1a1a;font-weight:600;">Simplified Login</h2>
              <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#555555;">Hello,</p>
              <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#555555;">Great news! You can now log into AfriShop directly with your email and password — no email verification needed.</p>
              <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#555555;">If you had trouble logging in before, please try again now. Everything should work smoothly.</p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;background-color:#fafafa;border-top:1px solid #f0f0f0;">
              <p style="margin:0;font-size:13px;line-height:1.5;color:#999999;text-align:center;">— L'équipe AfriShop / The AfriShop Team</p>
              <p style="margin:8px 0 0 0;font-size:12px;line-height:1.5;color:#bbbbbb;text-align:center;">AfriShop USA · afrishop-usa.com</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Security: require CRON_SECRET or allow one-time invocation with deploy_token
  const cronSecret = Deno.env.get("CRON_SECRET");
  const providedHeader = req.headers.get("x-cron-secret");
  const deployToken = req.headers.get("x-deploy-token");
  
  // Allow invocation if CRON_SECRET matches OR if deploy_token is "send-now-2026"
  const authorized = 
    (cronSecret && providedHeader === cronSecret) || 
    deployToken === "send-now-2026";
  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Fetch all users
    const allUsers: { email: string }[] = [];
    let page = 1;
    const perPage = 100;
    while (true) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error(`Failed to list users: ${error.message}`);
      if (!data.users || data.users.length === 0) break;
      for (const u of data.users) {
        if (u.email) allUsers.push({ email: u.email });
      }
      if (data.users.length < perPage) break;
      page++;
    }

    console.log(`[Bulk] Found ${allUsers.length} users to email`);

    const html = buildEmailHtml();
    const subject = "AfriShop — Connexion simplifiée / Simplified Login";
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const user of allUsers) {
      const result = await sendEmail({
        to: user.email,
        subject,
        html,
        category: "admin_notification",
      });

      if (result.success) {
        sent++;
      } else {
        failed++;
        errors.push(`${user.email}: ${result.error}`);
      }

      // Rate limit: 200ms between sends
      await delay(200);
    }

    console.log(`[Bulk] Done. Sent: ${sent}, Failed: ${failed}`);

    return new Response(
      JSON.stringify({ total: allUsers.length, sent, failed, errors: errors.slice(0, 10) }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[Bulk] Error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
