
Goal: Unblock your Stripe webhook setup when the UI forces a Thin payload flow.

Plan:
1) Complete the Stripe flow even if Thin is forced
- If Stripe requires finishing Thin payload setup, finish it temporarily.
- Use the same endpoint URL for now:
  `https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/payments-webhook/stripe`

2) Keep Snapshot as the real active destination for payments
- Ensure you have one Snapshot destination configured with only:
  - `checkout.session.completed`
  - `checkout.session.expired`
- This is the destination your payment finalization logic expects.

3) Remove or disable Thin destination after creation
- In Stripe Webhooks/Destinations list, open the Thin destination and delete/disable it.
- If Stripe won’t allow deletion, leave it enabled but remove its selected events so it becomes harmless.

4) Copy the correct signing secret
- Reveal the signing secret from the Snapshot destination (the one with 2 events above).
- Use that `whsec_...` value in your backend webhook secret configuration.
- Do not use the Thin destination secret if Snapshot is the one you keep.

5) Verify end-to-end
- Trigger a test checkout and confirm:
  - Webhook receives `checkout.session.completed`
  - Order status transitions correctly (paid/cancelled behavior works)
- If you get `Invalid signature (401)`, the secret in backend doesn’t match the active Stripe destination secret.

Technical notes:
- Same endpoint URL can be used by both Thin and Snapshot.
- The important part is payload format + matching signing secret.
- Your current payments handler is designed around Snapshot-style event data for checkout session finalization.
