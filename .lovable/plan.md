

## Plan: Clean Up Legacy MaishaPay from Database and Code

### Summary
Remove all legacy MaishaPay references from the database schema and edge functions. The `maisha_payments` table, MaishaPay-specific columns on `orders`, and MaishaPay-specific columns on `settings` will be dropped. Edge functions that reference these will be updated to use the modern `payment_attempts` table and generic column names instead.

---

### Phase 1: Database Migration

**Drop the `maisha_payments` table entirely:**
```sql
DROP TABLE IF EXISTS public.maisha_payments;
```

**Drop MaishaPay columns from `orders` table:**
- `maisha_payment_status`
- `maisha_transaction_id`
- `maisha_description`
- `maisha_status_code`

**Drop MaishaPay columns from `settings` table:**
- `maishapay_max_usd`
- `maishapay_max_cdf`

**Drop MaishaPay column from `checkout_sessions` table:**
- `maisha_reference`

**Update `finalize_paid_order` function** to remove the `maisha_payments` UPDATE and stop setting `maisha_payment_status`.

**Update `cleanup_all_expired_data` function** to remove MaishaPay references.

**Update `get_public_config` function** to remove `maishapay_max_usd` / `maishapay_max_cdf` return values.

**Drop MaishaPay-related indexes:**
- `idx_maisha_payments_status`
- `idx_maisha_payments_order_id`

---

### Phase 2: Edge Function Updates (19 files)

| Function | Change |
|---|---|
| `mobile-order-status` | Remove `maisha_payment_status` from select; use `payment_attempts` for status |
| `mobile-get-order-by-id` | Remove `maisha_payments` join; use `payment_attempts` instead |
| `mobile-get-orders` | Remove `maisha_payments` join; use `payment_attempts` instead |
| `mobile-checkout` | Stop writing `maisha_payment_status` and `maisha_transaction_id` to orders |
| `mobile-verify-payment` | Remove `maisha_payment_status` check; rely on `order.status` only |
| `generate-payment-receipt` | Remove `maisha_transaction_id` fallback; use `operator_ref_id` |
| `ai-order-assistant` | Replace `maisha_payment_status` with `status` in prompt |
| `payment-status` | Remove `maisha_payments` fallback lookup |
| `send-payment-confirmation` | Remove `maisha_payments` fallback for confirmation code |
| `reconcile-payment-status` | Remove `maisha_payments` table queries; use `payment_attempts` only |
| `admin-reset-section` | Remove `maisha_payments` delete calls |
| `admin-bulk-delete-orders` | Remove `maisha_payments` delete from cascade |
| `admin-delete-order` | Remove `maisha_payments` delete step |
| `mobile-public-config` | Remove `maishapay_max_usd/cdf` from settings query and response |
| `mobile-health` | Remove MaishaPay secret checks |
| `payment-decision` | Clean up MaishaPay comments |
| `mobile-create-payment` | Remove any MaishaPay references |
| `mobile-retry-payment` | Remove any MaishaPay references |
| `cleanup-expired-data` | Remove MaishaPay references |

---

### Phase 3: Frontend Code
The only `src/` file with MaishaPay references is `src/integrations/supabase/types.ts`, which is **auto-generated** and will update automatically after the database migration runs.

No manual frontend code changes needed.

---

### Risks & Mitigation
- **Historical orders**: Orders that were paid via MaishaPay will lose the `maisha_payment_status` column, but the `status` column on `orders` (e.g., `PAID`) already reflects the true state. The `payment_attempts` table has the payment records for recent orders.
- **Mobile app compatibility**: If a mobile app build still reads `maisha_payment_status`, the field will be `null` — the edge functions already fall back gracefully.
- **Rollback**: The migration can be reversed by re-adding columns, but data in dropped columns will be lost. Consider backing up `maisha_payments` data first if needed.

