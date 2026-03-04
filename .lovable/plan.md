

## Diagnosis: Stripe Webhook Returning 401 (Invalid Signature)

### What I Found

The `payments-webhook` edge function **is deployed and responding** -- I tested it and got back `HTTP 401: {"success":false,"error":"Invalid signature"}`. This is exactly the error Stripe is seeing with all 15 failed attempts.

The signature verification code in `stripeAdapter.ts` is technically correct (standard HMAC-SHA256 with timestamp tolerance). The function, CORS headers, and routing all work fine. The problem is that the **`STRIPE_WEBHOOK_SECRET` stored in your secrets does not match the signing secret for this webhook endpoint in Stripe**.

This typically happens when:
- The webhook endpoint was created (or re-created) in the Stripe Dashboard, generating a new signing secret (`whsec_...`), but the old value is still stored in your project secrets
- Or the secret was set for test mode but the webhook is firing in live mode (or vice versa)

### Plan

1. **Update `STRIPE_WEBHOOK_SECRET`** -- You need to go to your Stripe Dashboard → Developers → Webhooks → click the endpoint `https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/payments-webhook/stripe` → reveal the Signing Secret (`whsec_...`) → then I'll update it in the project secrets using the `add_secret` tool.

2. **Redeploy the function** after updating the secret to ensure it picks up the new value.

3. **Test the webhook** using the curl tool to confirm it returns 200.

### What You Need To Do

Please go to your **Stripe Dashboard → Developers → Webhooks**, click on the failing endpoint, and copy the **Signing secret** (starts with `whsec_`). Share it with me and I will update it in your project secrets.

