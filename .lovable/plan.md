

# Plan: Re-trigger Bulk Email Send

Your Resend Pro quota is fully reset: **0/50,000 used**, **unlimited daily limit**, **2 req/s rate**.

## What needs to happen

**No code changes needed.** The `send-bulk-announcement` edge function is already deployed and correct. I just need to:

1. **Redeploy** the function (to ensure it's fresh and won't hit any stale container issues)
2. **Invoke** it via POST with `x-deploy-token: send-now-2026` and `dry_run: false`
3. **Monitor logs** to confirm emails are flowing successfully

The function will fetch all registered users, then send each one the bilingual (French/English) "Connexion simplifiée" announcement with a 600ms delay between sends to stay under the 2 req/s rate limit.

## Expected outcome

All registered users receive the announcement email. The function returns a JSON summary with `sent` and `failed` counts.

