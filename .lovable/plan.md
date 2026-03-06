
You’re very close. The error is happening because your migration calls `gen_random_bytes(32)` without a schema, but in your target database that function is in the `extensions` schema.

## Fastest fix (do this now)

1) In SQL Editor of your target project, run this exact block:

```sql
-- Make sure extension exists
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Create compatibility wrapper so old migrations using gen_random_bytes(...) work
CREATE OR REPLACE FUNCTION public.gen_random_bytes(integer)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT extensions.gen_random_bytes($1);
$$;
```

2) Re-run migrations from terminal:

```bash
cd ~/Desktop/idea-funded-launch
supabase db push
```

## If it still fails on the same file

Run debug once to confirm:

```bash
supabase db push --debug
```

Then use fallback path:

1) Mark that one migration as applied:
```bash
supabase migration repair 20251202192202 --status applied
```

2) Open `supabase/migrations/20251202192202_bc566fcc-95b5-4969-8ba4-cc744ac9d72f.sql`, replace:
- `gen_random_bytes(32)` → `extensions.gen_random_bytes(32)`

3) Run that migration SQL manually in SQL Editor, then continue:
```bash
supabase db push
```

## Why this works

Your old migrations assume `gen_random_bytes` is reachable via `search_path`. In this new project it isn’t, so adding the wrapper in `public` (or schema-qualifying with `extensions.`) makes legacy SQL compatible.

## After this succeeds

Next command will be:
```bash
supabase functions deploy --no-verify-jwt
```
Then we’ll verify secrets and cron jobs.
