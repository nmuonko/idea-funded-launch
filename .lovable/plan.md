

## Pre-Migration Readiness Check

Before pointing the web app to the new database (`ecqpqtirhpumfgbdtvhh`), we need a comprehensive diagnostic edge function that validates everything exists and nothing was lost during migration.

### What We Will Build

A new edge function called **`migration-readiness-check`** that runs against the new project and produces a full report covering:

#### 1. Table Existence and Row Counts
Query `information_schema.tables` and `pg_stat_user_tables` to verify all expected tables exist. Compare row counts against expected minimums (e.g., `catalog_items` should have ~519K rows, not 348).

**Tables to check** (extracted from `types.ts` — roughly 80+ tables):
- Core: `profiles`, `orders`, `order_items`, `catalog_items`, `catalog_categories`, `catalog_collections`, `catalog_config`
- Auth/Admin: `admin_users`, `admin_settings`, `admin_invitations`, `admin_audit_logs`, `admin_notifications`, `admin_user_permissions`, `user_roles`
- Cart/Checkout: `carts`, `cart_items`, `guest_confirmations`, `cart_recovery_ab_tests`, `cart_recovery_predictions`
- Payments: `payments`, `payment_methods`, `payment_providers`, `bank_transfer_settings`, `bank_transfer_submissions`
- Catalog infra: `catalog_cache`, `catalog_cache_settings`, `catalog_facets_cache`, `catalog_home_cache`, `catalog_collection_cache`, `catalog_category_ttl`, `catalog_filter_profiles`, `catalog_builder_goals`, `catalog_builder_runs`, `catalog_builder_sources`, `catalog_builder_state`
- Home/Content: `home_recipes`, `home_recipe_items`, `home_sections`, `home_seed_suggestions`
- Referrals: `referrers`, `referral_rewards`, `referral_payout_claims`, `referral_payout_rules`, `referral_topup_log`
- Cars: `cars_listings_cache`, `cars_search_cache`, `cars_settings`, `cars_api_usage`, `cars_rate_limits`
- Support: `support_tickets`, `support_messages`, `customer_satisfaction`
- Config: `shipping_types`, `provider_budget`, `rate_limits`, `app_runtime_config`
- And all remaining tables from the schema

#### 2. Critical Data Counts with Thresholds
Flag tables where row counts are suspiciously low:
- `catalog_items` < 500,000 → WARNING
- `profiles` = 0 → WARNING (no users migrated)
- `orders` = 0 → INFO (may be expected)
- `home_recipes` = 0 → WARNING (home page will be empty)

#### 3. Database Functions and Extensions
- Query `pg_proc` to verify key RPC functions exist: `get_table_statistics`, `has_role`, etc.
- Query `pg_extension` to confirm required extensions: `pg_cron`, `pg_net`, `pgcrypto`, `uuid-ossp`

#### 4. pg_cron Jobs
- Query `cron.job` to list all scheduled jobs and verify all 18 expected jobs are present

#### 5. Edge Function Secrets
- Boolean check (no values exposed) for all 36 required secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAWAPAY_API_TOKEN`, `PAWAPAY_BASE_URL`, `RESEND_API_KEY`, `OPENAI_API_KEY`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`, `RAINFOREST_API_KEY`, `RELOADLY_CLIENT_ID`, `RELOADLY_CLIENT_SECRET`, `CRON_SECRET`, `FRONTEND_BASE_URL`, `ADMIN_NOTIFICATION_EMAIL`, `EMAIL_FROM_ADDRESS`, etc.

#### 6. RLS Policy Check
- Query `pg_policies` to count RLS policies per table and flag any table with RLS enabled but zero policies

#### 7. Storage Buckets
- Verify expected storage buckets exist (if any)

### Output Format

The function returns a structured JSON report:
```json
{
  "ready": true/false,
  "timestamp": "...",
  "summary": { "total_checks": 150, "passed": 148, "warnings": 2, "errors": 0 },
  "tables": { "catalog_items": { "exists": true, "rows": 519000, "status": "ok" }, ... },
  "functions": { "get_table_statistics": true, "has_role": true, ... },
  "extensions": { "pg_cron": true, "pg_net": true, ... },
  "cron_jobs": { "count": 18, "jobs": [...] },
  "secrets": { "STRIPE_SECRET_KEY": true, ... },
  "rls": { "tables_with_rls": 40, "tables_missing_policies": [] },
  "warnings": ["catalog_items has only 348 rows, expected 500000+"],
  "errors": []
}
```

### Implementation

- **1 new file**: `supabase/functions/migration-readiness-check/index.ts`
- Uses `createAdminClient()` from shared auth (service role key to bypass RLS and read system tables)
- Requires admin authentication to call
- All checks run in parallel for speed
- No secrets or sensitive data exposed in the response — only boolean flags and counts

