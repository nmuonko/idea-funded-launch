
# Fix: Home Rotation Button Times Out and Doesn't Update

## Problem Analysis

The "Refresh Now" button (Home Rotation) triggers the `catalog-prewarm-home` edge function, which:

1. **Processes 8 sections sequentially** (phones, vehicles, gaming, computers, clothing, home_garden, refurbished, parts_accessories)
2. **Each section makes multiple API calls**:
   - 3 Amazon/Rainforest API calls per section
   - 3 eBay API calls per section
   - Database reads/writes for caching, seen items, and catalog_items
3. **Total operations**: ~48 API calls + ~24 database operations = easily 60-120 seconds

Edge Functions have strict timeouts (typically 150s on Supabase), and network latency compounds the issue. The function times out before completing, so:
- The cache is never fully populated
- The home page continues showing stale/fallback data
- Users see no change

---

## Solution: Async Queue-Based Architecture

Instead of waiting for the prewarm to complete, implement an **immediate-return pattern** where:

1. **Edge Function returns immediately** after queuing the job
2. **Background processing** handles the actual prewarming (in smaller chunks or via scheduled execution)
3. **Status tracking** allows the admin to see progress

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                    ASYNC PREWARM ARCHITECTURE                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Admin clicks "Refresh Now"                                             │
│       │                                                                  │
│       ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  catalog-prewarm-home (FAST - returns in <1 second)              │    │
│  │                                                                   │    │
│  │  1. Insert job into prewarm_jobs table with status='pending'     │    │
│  │  2. Return immediately with job_id                               │    │
│  │                                                                   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│       │                                                                  │
│       ▼                                                                  │
│  UI shows "Prewarm started" immediately                                 │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  OPTION A: Trigger background worker                            │    │
│  │  catalog-prewarm-worker (separate edge function)                │    │
│  │  - Processes 1-2 sections per invocation                        │    │
│  │  - Chains to next worker via pg_cron or self-invocation         │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  OPTION B: Process sections in parallel                         │    │
│  │  - Each section runs independently with shorter timeout         │    │
│  │  - Promise.allSettled with per-section error handling           │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Immediate Return with Job Tracking

**Create new table: `prewarm_jobs`**

```sql
CREATE TABLE prewarm_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending',  -- pending, processing, completed, failed
  rotation_key text,
  sections_total integer DEFAULT 0,
  sections_completed integer DEFAULT 0,
  amazon_fetched integer DEFAULT 0,
  ebay_fetched integer DEFAULT 0,
  mixed_total integer DEFAULT 0,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);
```

**Update `catalog-prewarm-home` to return immediately**

```typescript
// NEW FLOW:
// 1. Create pending job record
// 2. Return immediately with job ID
// 3. Trigger background processing (via Edge Function or self-chain)

const { data: job } = await supabase
  .from('prewarm_jobs')
  .insert({
    status: 'pending',
    rotation_key: rotationKey,
    sections_total: HOME_PREWARM_SECTIONS.length,
  })
  .select()
  .single();

// Trigger background worker (fire-and-forget)
fetch(`${supabaseUrl}/functions/v1/catalog-prewarm-worker`, {
  method: 'POST',
  headers: { 
    'Authorization': `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ jobId: job.id })
}).catch(() => {}); // Fire and forget

// Return immediately
return new Response(JSON.stringify({
  ok: true,
  jobId: job.id,
  status: 'queued',
  message: 'Home prewarm started in background',
}), ...);
```

### Phase 2: Background Worker Function

**Create `catalog-prewarm-worker/index.ts`**

Processes sections one at a time with progress updates:

```typescript
// Receives jobId, processes each section sequentially or in small batches
// Updates prewarm_jobs.sections_completed after each section
// Handles timeout by resuming from last completed section
```

### Phase 3: UI Updates for Progress Tracking

**Update `CatalogSourcesSettings.tsx`**

1. Show "Starting..." immediately when button clicked
2. Poll job status every 3-5 seconds
3. Display progress bar: "3/8 sections completed"
4. Show completion message when done

```typescript
// After prewarm call returns jobId
const pollJobStatus = async (jobId: string) => {
  const { data: job } = await supabase
    .from('prewarm_jobs')
    .select('*')
    .eq('id', jobId)
    .single();
  
  if (job.status === 'completed') {
    // Show success
  } else if (job.status === 'failed') {
    // Show error
  } else {
    // Update progress UI
    setProgress(`${job.sections_completed}/${job.sections_total} sections`);
    setTimeout(() => pollJobStatus(jobId), 3000);
  }
};
```

---

## Files to Create/Modify

### Database Changes
1. **New table**: `prewarm_jobs` for job tracking

### Edge Functions
1. **Modify**: `supabase/functions/catalog-prewarm-home/index.ts`
   - Return immediately after creating job
   - Fire background worker

2. **Create**: `supabase/functions/catalog-prewarm-worker/index.ts`
   - Process sections one at a time
   - Update job progress
   - Handle resumption on timeout

### Frontend
1. **Modify**: `src/pages/admin/CatalogSourcesSettings.tsx`
   - Handle async response with jobId
   - Add polling for job status
   - Show progress indicator

---

## Alternative Simpler Approach: Parallel Processing with Short Timeouts

If the queue approach is too complex, a simpler fix:

1. **Process all sections in parallel** using `Promise.allSettled`
2. **Add per-section timeout of 10 seconds**
3. **Reduce API calls per section** (1 query instead of 3)
4. **Return partial results** even if some sections fail

This reduces total time from ~120s to ~15-20s.

---

## Technical Details

### Current Flow (Broken)
```
Button Click → Edge Function (60-120s) → Timeout → No update
```

### New Flow (Queue-Based)
```
Button Click → Edge Function (200ms) → Job Queued → Background Worker → Cache Updated
                 ↓
           UI: "Started!" → Poll Status → "3/8 sections..." → "Complete!"
```

### New Flow (Parallel Simplification)
```
Button Click → Edge Function (15-20s) → Partial Success → Cache Updated
                                              ↓
                                       UI: "5/8 sections refreshed"
```

---

## Recommended Approach

**Implement the simpler Parallel Processing fix first**:
1. Faster to implement
2. No new infrastructure (no job table)
3. Significantly reduces total time
4. Acceptable partial success behavior

If that's still too slow, then implement the full queue architecture.

---

## Expected Outcomes

| Metric | Before | After (Parallel) | After (Queue) |
|--------|--------|------------------|---------------|
| Response time | 60-120s (timeout) | 15-20s | <1s |
| User feedback | None (hangs) | Immediate result | Immediate + progress |
| Success rate | 0% (always times out) | ~80% (partial) | 100% |
| Home page update | Never | After button returns | After background completes |
