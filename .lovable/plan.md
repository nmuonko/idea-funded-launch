

## Make Catalog Growth Automatic in Live

### Problem
All catalog-building cron jobs (Auto-Learning, queue processor, stale refresh) only exist in the **Test** database. They call `_cron_call_refresh_worker`, which is hardcoded to the Test edge function URL. This means:
- All 66K items accumulate in Test only
- Live stays at 34K and only grows when you manually export/import
- Even the `_cron_call_refresh_worker` function **in Live** still points to the Test URL -- so it would write to Test even if cron jobs existed in Live

### Solution (3 steps)

#### Step 1: Fix the helper function in Live
Update `_cron_call_refresh_worker` in the Live database to point to the **Live** edge function URL (`igmkhxffnyzoogcqvdab`) instead of the Test URL (`wydajcvmdoaqvovncotu`).

#### Step 2: Create catalog cron jobs in Live
Add the same 4 catalog cron jobs that exist in Test:

| Job | Schedule | Mode |
|-----|----------|------|
| Catalog Builder (Auto-Learning) | Every 10 min | `catalog-builder` |
| Queue Processor | Every 30 min | `queue` (50 jobs) |
| Stale Refresh | Every 6 hours | `stale` (20 jobs) |
| Pool Fill | Daily at 3 AM | `pool-fill` |

Also add the `promote_popular_searches` and `aggregate_popularity_scores` jobs if missing in Live.

#### Step 3: One-time catch-up sync
Do one final export/import to bring Live from 34K to 66K. After that, Live will grow independently from its own cron jobs.

### Technical Details

**SQL for Live** (to be run in Cloud View with Live selected):

```text
-- Step 1: Fix the helper function URL
CREATE OR REPLACE FUNCTION public._cron_call_refresh_worker(p_mode text, p_body jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_url text;
  v_headers jsonb;
BEGIN
  v_url := 'https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/catalog-refresh-worker';
  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-internal-cron-key', 'afrishop-internal-cron-2026'
  );
  PERFORM net.http_post(
    url := v_url,
    headers := v_headers,
    body := p_body || jsonb_build_object('mode', p_mode)
  );
END;
$$;

-- Step 2: Create catalog cron jobs
SELECT cron.schedule('catalog-builder-campaign', '*/10 * * * *',
  $$SELECT public._cron_call_refresh_worker('catalog-builder');$$
);

SELECT cron.schedule('catalog-refresh-worker-queue', '*/30 * * * *',
  $$SELECT public._cron_call_refresh_worker('queue', '{"maxJobs":50}'::jsonb)$$
);

SELECT cron.schedule('catalog-refresh-stale-6h', '30 */6 * * *',
  $$SELECT public._cron_call_refresh_worker('stale', '{"maxJobs":20}'::jsonb)$$
);

SELECT cron.schedule('catalog-pool-fill-daily', '0 3 * * *',
  $$SELECT public._cron_call_refresh_worker('pool-fill', '{}'::jsonb)$$
);

SELECT cron.schedule('promote-popular-searches-6h', '0 */6 * * *',
  $$SELECT public.promote_popular_searches(3, 24, true);$$
);

SELECT cron.schedule('aggregate-popularity-daily', '0 4 * * *',
  $$SELECT public.aggregate_popularity_scores();$$
);
```

**Important caveat**: The `_cron_call_refresh_worker` function is defined via a migration, so every time you **Publish**, it will get overwritten back to the Test URL. To prevent this:
- Update the migration source to use a dynamic approach (environment variable or a settings row), OR
- After each publish, re-run the URL fix SQL in Live

To make this permanent, I will also update the `_cron_call_refresh_worker` migration to read the URL from an `admin_settings` row instead of hardcoding it, so it works correctly in both environments without post-publish fixups.

### Files to Modify
- `supabase/functions/catalog-refresh-worker/index.ts` -- No changes needed (already works with any Supabase URL)
- SQL migration -- Update `_cron_call_refresh_worker` to read URL from `admin_settings` or `environments` table instead of hardcoding

### After Implementation
- Live will independently grow its catalog via the same Auto-Learning and queue jobs
- No more manual export/import needed
- One final sync brings Live from 34K to 66K, then both environments run independently

