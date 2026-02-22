

# Fix Smart Product Updates: Jobs Not Processing

## Root Cause

The "Bulk Product Import" button triggers `seed-backfill` mode, which tries to process ALL 431 queued jobs in a single edge function call. With ~2 seconds per job (800ms delay + eBay API call), processing all jobs would take ~15 minutes -- but the edge function times out after ~150 seconds. Result: only ~50 jobs get processed per click, and the cron job only handles 30 jobs every 6 hours.

**Why progress bars don't move:** After the function times out, remaining jobs stay "queued" with no active processor. The cron is too infrequent (every 6 hours) and too small (30 jobs) to make visible progress.

## Solution

Two changes to make bulk import actually drain the queue:

### 1. Increase cron frequency and batch size

Change the `catalog-refresh-worker-queue` cron from every 6 hours to every 30 minutes, and increase batch size from 30 to 50. This ensures queued jobs are continuously processed.

**Technical:** Run SQL to update cron schedules:
```text
catalog-refresh-worker-queue: */30 * * * * (every 30 min, 50 jobs)
catalog-refresh-worker-stale:  0 */6 * * * (keep as-is)
```

### 2. Add auto-retry loop in the admin UI

After clicking "Bulk Import", the frontend will automatically poll and re-trigger the worker every 30 seconds until the queue is drained. This gives immediate visible progress instead of waiting for cron.

**Technical changes in `src/pages/admin/AutoLearning.tsx`:**
- After `runSeedBackfill` completes, start a polling interval that:
  1. Fetches backfill status (queue count)
  2. If queued > 0, triggers another worker batch via `admin-auto-learning?action=run-seed-backfill`
  3. Updates the progress display in real-time
  4. Stops when queue reaches 0
- Show a "processing X remaining..." indicator with live count updates
- Add a "Stop Import" button to cancel the loop

### 3. Switch bulk import from seed-backfill to queue mode

The seed-backfill mode re-enqueues ALL seeds every time (even already-done ones via `enqueue_all_seeds_ebay`). Instead, the "Continue Import" re-triggers should use `queue` mode which just processes existing queued jobs -- much more efficient.

**Technical changes in `supabase/functions/admin-auto-learning/index.ts`:**
- Add a new action `continue-backfill` that calls the worker in `queue` mode with `maxJobs: 50`
- The UI polling loop uses this new action instead of re-running full seed-backfill

### Summary of file changes

| File | Change |
|------|--------|
| `src/pages/admin/AutoLearning.tsx` | Add auto-polling loop after bulk import, live progress counter, stop button |
| `supabase/functions/admin-auto-learning/index.ts` | Add `continue-backfill` action that calls worker in queue mode |
| SQL migration | Update cron schedule to run every 30 minutes with larger batch |

