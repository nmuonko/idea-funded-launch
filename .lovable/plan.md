## Add support contact line to payment receipts

The receipt currently shows the buyer's email under CLIENT and only mentions support in the small footer text. Add a clear support contact line so the support email is visible alongside the buyer's email.

### Change

File: `supabase/functions/generate-payment-receipt/index.ts`

In the CLIENT info section (around line 134-138), after the buyer's Email/Téléphone lines, add:

```
Support : nkadimisha@afrishop-usa.com
```

The buyer's email (e.g. `futurescopellc@gmail.com`) stays unchanged. Footer line that already mentions the support email stays as-is (acts as redundant reinforcement).

No DB, no other surfaces — this is the only receipt template (PDF/print HTML). Confirmation emails are a separate template and were not part of this request.