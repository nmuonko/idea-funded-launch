
Fix the hot-products campaign flow so it both sends reliably and shows clear confirmation in the admin portal.

1. Identify and handle the real failure state
- The latest campaign is stuck in `sending` with `sent_count = 0`, `failed_count = 0`, and no completion timestamp.
- I’ll update the send flow so a campaign can never stay stuck silently:
  - `draft` → `approved` / `sending`
  - `sent` when finished
  - `failed` when the send process crashes before completion
- I’ll store a campaign-level error message and timestamps so the admin page can explain what happened.

2. Add delivery tracking for each recipient
- Create a dedicated campaign delivery log table for marketing sends.
- Each attempted recipient send will record:
  - campaign
  - recipient email
  - status (`pending`, `sent`, `failed`)
  - provider message id if available
  - error message if failed
  - timestamps
- This gives a real source of truth instead of only aggregate counters.

3. Harden the email-sending function
- Update `send-hot-products-email` to:
  - validate the campaign before sending
  - record send start immediately
  - write recipient-level logs as it sends
  - update aggregate counters incrementally
  - mark the campaign `failed` if the function exits early
  - return a clearer summary payload to the admin page
- I’ll also add explicit logging around:
  - recipient loading
  - zero-recipient cases
  - provider/API failures
  - campaign completion

4. Improve the admin portal confirmation UX
- Update `src/pages/admin/HotProducts.tsx` so the campaign history shows:
  - status badge (`draft`, `sending`, `sent`, `failed`)
  - sent / failed counts
  - last error when relevant
  - sent time / last updated time
- Add a “View delivery report” UI for each campaign showing recipient-level results.
- Add a “Retry send” action for failed or stale campaigns.

5. Prevent misleading success messages
- The current UI can show success too early and does not expose enough failure detail.
- I’ll change it so the admin page only shows:
  - “campaign started” when the backend accepted the job
  - “campaign completed” when the final result is returned or refreshed from stored status
- If the send cannot start, the UI will show the actual error instead of leaving the campaign in a vague state.

Technical details
- Files to update:
  - `src/pages/admin/HotProducts.tsx`
  - `supabase/functions/send-hot-products-email/index.ts`
- Database changes:
  - add a delivery-log table for hot-product campaigns
  - add campaign-level failure metadata if not already present
  - protect all log data with admin-only access rules
- Result:
  - you’ll be able to confirm inside the admin portal whether a campaign was sent, how many emails succeeded, which failed, and why.
