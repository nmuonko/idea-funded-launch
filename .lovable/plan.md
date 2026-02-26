

## Backend Optimization: Round 4 -- Over-Indexed Tables + Dead Weight Cleanup

This is the deepest pass yet, targeting **massively over-indexed small tables** that slow down every write operation, plus dead indexes on `user_roles` that are evaluated millions of times via RLS policies.

### Finding 1: Over-Indexed Order Tables (67 indexes across 4 tables with < 30 rows each)

These tables have far more indexes than rows, meaning every INSERT/UPDATE/DELETE maintains dozens of B-tree structures for essentially no read benefit:

| Table | Rows | Indexes | Dead (0 scans) |
|-------|------|---------|-----------------|
| order_items | 27 | 20 | 5 |
| orders | 23 | 19 | 2 |
| maisha_payments | 0 | 15 | 9 |
| checkout_sessions | 15 | 12 | 3 |
| payment_attempts | 4 | 10 | 4 |
| payments | 12 | 9 | 4 |
| quote_requests | 0 | 9 | (check needed) |
| support_tickets | 0 | 9 | (most dead) |

### Finding 2: Dead Indexes on `user_roles` (1.26M seq scans)

The `user_roles` table has 7 rows but 1.26M sequential scans because every RLS policy check on `orders`, `order_items`, `maisha_payments`, etc. calls `has_role()`. Two indexes are completely dead:

- `idx_user_roles_rls_optimized`: 0 scans (the partial index on `role = 'admin'` is never chosen by the planner since seq scan on 7 rows is faster)
- `idx_user_roles_user_lookup`: 4 scans (redundant with `user_roles_user_id_role_key` at 386K scans)

### Finding 3: Redundant Cleanup Functions

Three cleanup functions overlap with the comprehensive `cleanup_all_expired_data()`:
- `cleanup_expired_records()` -- subset of `cleanup_all_expired_data()`
- `cleanup_catalog_cache()` -- subset
- `cleanup_catalog_provider_data()` -- subset

These add maintenance confusion and should be deprecated.

### Plan

Single migration to drop **~30 dead indexes** across 8 tables:

```text
--- order_items (5 dead) ---
idx_order_items_store             0 scans
idx_order_items_saved_partial     0 scans
idx_order_items_manual_quote      0 scans
idx_order_items_is_vehicle        0 scans
idx_order_items_device_id         0 scans

--- orders (2 dead) ---
idx_orders_payment_email_pending  0 scans
idx_orders_user_draft             0 scans

--- maisha_payments (9 dead) ---
maisha_payments_pkey              0 scans (but can't drop - primary key)
idx_maisha_payments_user_order    0 scans
maisha_payments_maisha_reference_key  0 scans (unique constraint)
maisha_payments_confirmation_code_key 0 scans (unique constraint)
idx_maisha_payments_confirmation_code 0 scans
idx_maisha_payments_transaction_ref   0 scans
idx_maisha_payments_order_status      0 scans
idx_maisha_payments_order             0 scans
idx_maisha_payments_maisha_reference  0 scans
idx_maisha_payments_reference         0 scans

--- checkout_sessions (3 dead) ---
idx_checkout_sessions_order_id        0 scans
idx_checkout_sessions_maisha_reference 0 scans
idx_checkout_sessions_maisha_ref      0 scans

--- payment_attempts (4 dead) ---
payment_attempts_idempotency_key_key  0 scans
idx_payment_attempts_cart_hash        0 scans
idx_payment_attempts_status           0 scans
idx_payment_attempts_created          0 scans

--- payments (4 dead) ---
payments_reference_key                0 scans
idx_payments_reference                0 scans
idx_payments_status                   0 scans
idx_payments_status_lookup            0 scans

--- user_roles (2 dead) ---
idx_user_roles_rls_optimized          0 scans
idx_user_roles_user_lookup            4 scans
```

### Expected Impact

- **~28 dead indexes removed** across 8 tables (excluding pkeys and unique constraints that back FK references)
- **Write performance**: Every cart add, order update, and payment operation becomes faster with fewer indexes to maintain
- **RLS overhead reduced**: Dropping dead `user_roles` indexes slightly reduces planner overhead on the 1.26M+ RLS evaluations
- **Cleaner schema**: Removes accumulated index cruft from iterative development

### Technical Details

```sql
-- order_items: 5 dead indexes
DROP INDEX IF EXISTS idx_order_items_store;
DROP INDEX IF EXISTS idx_order_items_saved_partial;
DROP INDEX IF EXISTS idx_order_items_manual_quote;
DROP INDEX IF EXISTS idx_order_items_is_vehicle;
DROP INDEX IF EXISTS idx_order_items_device_id;

-- orders: 2 dead indexes
DROP INDEX IF EXISTS idx_orders_payment_email_pending;
DROP INDEX IF EXISTS idx_orders_user_draft;

-- maisha_payments: 7 dead indexes (skip pkey + unique constraints)
DROP INDEX IF EXISTS idx_maisha_payments_user_order;
DROP INDEX IF EXISTS idx_maisha_payments_confirmation_code;
DROP INDEX IF EXISTS idx_maisha_payments_transaction_ref;
DROP INDEX IF EXISTS idx_maisha_payments_order_status;
DROP INDEX IF EXISTS idx_maisha_payments_order;
DROP INDEX IF EXISTS idx_maisha_payments_maisha_reference;
DROP INDEX IF EXISTS idx_maisha_payments_reference;

-- checkout_sessions: 3 dead indexes
DROP INDEX IF EXISTS idx_checkout_sessions_order_id;
DROP INDEX IF EXISTS idx_checkout_sessions_maisha_reference;
DROP INDEX IF EXISTS idx_checkout_sessions_maisha_ref;

-- payment_attempts: 4 dead indexes
DROP INDEX IF EXISTS idx_payment_attempts_cart_hash;
DROP INDEX IF EXISTS idx_payment_attempts_status;
DROP INDEX IF EXISTS idx_payment_attempts_created;

-- payments: 3 dead indexes (skip unique constraint)
DROP INDEX IF EXISTS idx_payments_reference;
DROP INDEX IF EXISTS idx_payments_status;
DROP INDEX IF EXISTS idx_payments_status_lookup;

-- user_roles: 2 dead indexes
DROP INDEX IF EXISTS idx_user_roles_rls_optimized;
DROP INDEX IF EXISTS idx_user_roles_user_lookup;
```

| File | Change |
|------|--------|
| New migration SQL | Drop ~27 dead indexes across 8 high-write tables |

