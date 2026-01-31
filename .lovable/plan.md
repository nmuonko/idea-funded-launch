
# Fix: Home Rotation Stalls at 7/8 Sections

## Problem

The background worker (`catalog-prewarm-worker`) processes all 8 sections in a single function invocation. Edge functions have a ~150 second timeout. When processing takes longer, the function dies mid-execution, leaving the job stuck in "processing" status forever.

Current situation:
- Job has been stuck for **883+ seconds** (15 minutes)
- Status: `processing` on section `parts_accessories`
- No way to detect or recover from this state

---

## Solution: Self-Chaining Worker Pattern

Split the work across multiple function invocations using a **self-chaining pattern**. Each invocation processes **one section only**, then triggers itself to process the next section.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                    SELF-CHAINING WORKER PATTERN                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  catalog-prewarm-home                                                   │
│       │                                                                  │
│       ▼                                                                  │
│  Creates job → Triggers worker (sectionIndex=0)                         │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Worker Invocation 1 (section: phones)                          │    │
│  │  - Process phones section (~15-20s)                             │    │
│  │  - Update job progress                                          │    │
│  │  - Trigger self (sectionIndex=1) → exits                        │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Worker Invocation 2 (section: vehicles)                        │    │
│  │  - Process vehicles section                                     │    │
│  │  - Update job progress                                          │    │
│  │  - Trigger self (sectionIndex=2) → exits                        │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  ... continues for all 8 sections ...                                   │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Worker Invocation 8 (section: parts_accessories)               │    │
│  │  - Process final section                                        │    │
│  │  - Mark job as completed                                        │    │
│  │  - No more self-invocation                                      │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Details

### 1. Update Worker to Process One Section at a Time

**Modify `catalog-prewarm-worker/index.ts`**:

- Accept `sectionIndex` parameter (default: 0)
- Process only the section at that index
- After completing, trigger itself with `sectionIndex + 1`
- Mark job complete when `sectionIndex >= sections.length`

```typescript
// New request body
interface WorkerRequest {
  jobId: string;
  sectionIndex?: number; // Which section to process (0-7)
}

// Main handler
const { jobId, sectionIndex = 0 } = await req.json();

// Process ONLY this one section
const section = HOME_PREWARM_SECTIONS[sectionIndex];
const result = await processSection(section, ...);

// Update progress
await supabase.from("prewarm_jobs").update({
  sections_completed: sectionIndex + 1,
  current_section: section.key,
  ...
}).eq("id", jobId);

// Chain to next section if more remain
const nextIndex = sectionIndex + 1;
if (nextIndex < HOME_PREWARM_SECTIONS.length) {
  // Fire-and-forget self-invocation
  fetch(`${supabaseUrl}/functions/v1/catalog-prewarm-worker`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${serviceKey}` },
    body: JSON.stringify({ jobId, sectionIndex: nextIndex })
  });
} else {
  // Mark job as completed
  await supabase.from("prewarm_jobs").update({
    status: "completed",
    completed_at: new Date().toISOString()
  }).eq("id", jobId);
}
```

### 2. Add Stall Detection and Auto-Recovery

**Add to `prewarm_jobs` table**:
- `last_heartbeat` column to track activity

**Frontend changes**:
- Detect stalled jobs (no progress for 60+ seconds)
- Show "Stalled" status with retry option
- Auto-timeout polling after 10 minutes

```typescript
// In pollJobStatus
const stalledThreshold = 60; // seconds
const secondsSinceStart = (Date.now() - new Date(job.started_at).getTime()) / 1000;
const isStalled = job.status === 'processing' && 
                  secondsSinceStart > stalledThreshold * (job.sections_completed + 1);

if (isStalled) {
  setJobProgress({ ...job, status: 'stalled' });
  // Stop polling, show "Retry" button
}
```

### 3. Clean Up Orphaned Jobs

Add logic to detect and mark stuck jobs:

```sql
-- Mark jobs stuck in "processing" for > 10 minutes as failed
UPDATE prewarm_jobs 
SET status = 'failed', 
    error_message = 'Timeout: Worker stopped responding'
WHERE status = 'processing' 
  AND started_at < NOW() - INTERVAL '10 minutes';
```

---

## Files to Modify

### Edge Functions
1. **`supabase/functions/catalog-prewarm-worker/index.ts`**
   - Accept `sectionIndex` parameter
   - Process only one section per invocation
   - Self-chain to next section
   - Update heartbeat timestamp

### Frontend
2. **`src/pages/admin/CatalogSourcesSettings.tsx`**
   - Add stall detection logic
   - Show "Stalled - Retry?" UI state
   - Add polling timeout (10 min max)
   - Add "Cancel Job" button

### Database (Optional)
3. **Add `last_heartbeat` column** to `prewarm_jobs`
   - Helps detect stalled jobs more accurately

---

## Benefits

| Aspect | Before | After |
|--------|--------|-------|
| Max execution per invocation | ~120s (hits timeout) | ~15-25s per section |
| Failure handling | Job stuck forever | Auto-detects stall, can retry |
| Progress visibility | Stops updating at failure point | Continues showing progress |
| Recovery | Manual DB fix required | UI retry button |
| Total time | N/A (never completes) | ~2-3 minutes total |

---

## Quick Fix for Current Stuck Job

Before implementing the full solution, reset the stuck job:

```sql
UPDATE prewarm_jobs 
SET status = 'failed', 
    error_message = 'Timeout during parts_accessories section',
    completed_at = NOW()
WHERE id = '320725c6-8c27-4828-bf57-04c53991e3c5';
```

This will clear the UI and allow a new prewarm attempt.
