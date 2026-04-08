

# Risk Assessment: Multi-App Transaction Tagging Plan

## Verdict: LOW RISK — but with two precautions

The plan is safe because every change is **additive** (new column, new metadata field). Nothing existing gets removed or rewritten. Here's the breakdown:

---

## ✅ Zero-Risk Changes (safe)

| Change | Why safe |
|--------|----------|
| Add `app` column with `DEFAULT 'afrishop'` | All existing rows automatically get the correct value. No data loss, no schema breakage |
| Add `metadata` array to pawaPay deposit requests | pawaPay's API accepts optional metadata — adding it doesn't change how the deposit is processed |
| Tag new records with `app: 'afrishop'` on insert | Just setting a column that already has the right default — purely defensive |

## ⚠️ One Real Risk: Callback Routing Logic

The plan says: *"If `app !== 'afrishop'`, skip processing."*

**The risk**: If a MaishaMarket callback arrives and the `depositId` isn't found in AfriShop's database, the current code **already handles this gracefully** — line 895-900 returns HTTP 200 with `"Payment not found"`. This is safe and prevents retries.

**Adding a metadata-based skip** is fine BUT introduces a subtle danger: if the metadata field is missing or malformed (e.g., pawaPay strips it in a future API change), we must **default to processing**, not skipping. Otherwise a real AfriShop payment could be silently dropped.

### Safeguard: Default to `'afrishop'` when metadata is absent

```
const appTag = metadata?.find(m => m.fieldName === 'app')?.fieldValue || 'afrishop';
// Only skip if explicitly tagged as another app
if (appTag !== 'afrishop') { return 200 skipped; }
```

This means: old transactions without metadata → processed normally. Only explicitly-tagged non-AfriShop transactions get skipped.

## ⚠️ Second Precaution: Don't touch the deposit request structure unnecessarily

The `PawaPayDepositRequest` type (line 28-41) doesn't include `metadata`. Adding it requires updating the type AND the request builder. This is straightforward but:
- We must verify pawaPay's API version supports the `metadata` field (their v2 docs confirm it does)
- The field must be sent as an array of `{fieldName, fieldValue}` objects — wrong format = deposit rejection

## What We Will NOT Change

- No changes to signature verification logic
- No changes to payment status transitions (COMPLETED → PAID)
- No changes to idempotency checks
- No changes to referral commission flow
- No changes to email notifications
- No changes to Stripe flow at all (separate provider, separate keys)

## Summary

| Risk | Mitigation |
|------|-----------|
| Metadata missing → payment skipped | Default `app` to `'afrishop'` when metadata absent |
| Wrong metadata format → deposit rejected by pawaPay | Follow exact `{fieldName, fieldValue}` schema from pawaPay v2 docs |
| Database migration breaks existing data | `DEFAULT 'afrishop'` ensures zero impact on existing rows |

**Bottom line**: No regression risk to payments if we implement the "default to afrishop" safeguard. The callback handler already gracefully handles unknown deposits. We're just adding a smarter skip layer on top.

