

# Plan: Send Bulk Email to All 234 Users — Login Update Announcement

## What We're Building

A new edge function `send-bulk-announcement` that:
1. Fetches all user emails from `auth.users`
2. Sends each one a branded, bilingual (French-first) email announcing they can now log in without email verification
3. Uses the existing Resend infrastructure and verified `afrishop-usa.com` domain
4. Includes the AfriShop logo hosted via public storage
5. Follows email best practices to avoid spam filters

## Spam/Junk Prevention Strategy

- **Verified sender domain**: `afrishop-usa.com` is already DNS-verified with Resend
- **Proper `from` address**: Using `nkadimisha@afrishop-usa.com` (already configured)
- **Plain text fallback**: Auto-generated from HTML (already in `sendEmail` helper)
- **No spammy language**: No ALL CAPS, no excessive exclamation marks, no "FREE" or "ACT NOW"
- **Proper HTML structure**: Clean, simple HTML with inline styles
- **Unsubscribe-friendly tone**: Informational, not promotional
- **Rate limiting**: Send one at a time with a small delay between sends to avoid Resend rate limits

## Logo

The logo file is at `src/assets/afrishop-logo.png`. Since this is a build-time asset (not publicly accessible via URL), we'll upload it to a public storage bucket and reference it via the public URL in the email.

## Email Content (French-first, English below)

**Subject**: AfriShop — Connexion simplifiée / Simplified Login

**Body** (preview):

```
[AfriShop Logo]

Bonjour,

Bonne nouvelle ! Vous pouvez maintenant vous connecter à AfriShop 
directement avec votre email et mot de passe — sans avoir besoin 
de vérifier votre email au préalable.

Si vous aviez des difficultés à vous connecter, essayez à nouveau 
maintenant. Tout devrait fonctionner parfaitement.

---

Hello,

Great news! You can now log into AfriShop directly with your email 
and password — no email verification needed.

If you had trouble logging in before, please try again now. 
Everything should work smoothly.

— L'équipe AfriShop / The AfriShop Team
```

## Implementation

### 1. Upload logo to storage bucket
- Create `email-assets` public bucket if it doesn't exist
- Upload `afrishop-logo.png` to the bucket
- Use the public URL in the email HTML

### 2. Create `send-bulk-announcement` edge function
- Uses `SUPABASE_SERVICE_ROLE_KEY` to list all users from `auth.users` via the admin API
- Iterates through all users, sends the branded email via the existing `sendEmail` helper
- Adds a 200ms delay between sends to respect rate limits
- Secured by `CRON_SECRET` header (no public access)
- Logs results: total sent, failed count

### 3. Deploy and invoke
- Deploy the function
- Call it once to send to all 234 users

## Files Created
- `supabase/functions/send-bulk-announcement/index.ts`

## No Breaking Changes
- No existing functionality is modified
- One-time use function that can be removed after sending

