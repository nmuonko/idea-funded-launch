

## The Fix: Edge Function Now Deployed

### What Was Wrong
The `catalog-data-sync` function was added to `config.toml` but had not actually been deployed to the Test environment. The logs showed only "booted" messages with zero request processing -- meaning the function was starting up but the code handling export pagination was never reached (likely an older/empty version was running).

### What Was Done
I just force-deployed the `catalog-data-sync` edge function with the latest code that includes:
- POST-based parameter reading (mode, page, pageSize from request body)
- Proper pagination (1,000 items per page, ordered by id)
- Total count and totalPages calculation

### What You Need To Do
1. Go back to **Test** admin panel at `/admin/catalog-cache`
2. Click **"Export All Items (JSON)"** again
3. The export should now paginate through all ~28 pages and download the full ~27,728 items
4. If it works, **Publish** the app, then import the JSON into the **Live** environment

### No Code Changes Needed
The code in both the edge function and the admin UI is already correct. The issue was purely a deployment gap -- the function wasn't actually running the latest code until now.
