

# Fix: Users Must Clear Browser Data to See Updates After Publish

## Problem
After publishing, returning users see stale content because the app aggressively caches data in `localStorage` with keys like `afrishop_cache:v13:*`, `afrishop_curated:*`, recent searches, etc. These caches have 1-2 hour TTLs but persist across deployments. Since no cache-busting mechanism is tied to the build/deploy, users see old product data, old home grids, and old search results until they manually clear browsing data.

Vite already handles JS/CSS asset cache-busting via content-hash filenames, so the **code** loads fresh. But the **data in localStorage** remains stale.

## Solution: Build-Time Version Stamp + Auto-Cache Bust on Load

Embed a unique build timestamp into the app at build time. On every app load, compare it against the last-seen version stored in localStorage. If different (i.e., a new deployment), automatically clear all AfriShop data caches.

## Changes

### 1. Add build version to Vite config
**File: `vite.config.ts`**

Use `define` to inject a compile-time constant `__BUILD_VERSION__` set to the current ISO timestamp. This changes with every build/publish, providing a unique deployment fingerprint.

### 2. Create a cache-bust utility
**File: `src/lib/cacheBust.ts`** (new file)

- Read `__BUILD_VERSION__` and compare against `localStorage.getItem('afrishop_build_version')`
- If they differ (new deployment detected):
  - Clear all `afrishop_cache:*` keys (catalog cache)
  - Clear all `afrishop_curated:*` keys (home category cache)
  - Clear `afrishop_recent_searches` and `afrishop_recently_viewed`
  - Store the new build version
  - Log `[CacheBust] New deployment detected, cleared stale caches`
- If they match: do nothing (normal load)
- Preserve non-cache keys (auth session, user preferences, etc.)

### 3. Call cache-bust on app startup
**File: `src/main.tsx`**

Import and call `bustStaleCache()` before `createRoot()`. This runs synchronously before the first render so users never see stale data from a previous deployment.

### 4. Bump the cache prefix version (belt-and-suspenders)
**File: `src/lib/catalogCache.ts`**

Change the prefix from `afrishop_cache:v13:` to `afrishop_cache:v14:` so that even without the cache-bust utility, old v13 entries won't match new lookups. This is a one-time migration measure.

---

## Technical Details

### Build version injection (vite.config.ts)
```typescript
define: {
  __BUILD_VERSION__: JSON.stringify(new Date().toISOString()),
}
```

### Cache bust logic (cacheBust.ts)
```typescript
declare const __BUILD_VERSION__: string;

const BUILD_KEY = 'afrishop_build_version';

export function bustStaleCache(): void {
  try {
    const stored = localStorage.getItem(BUILD_KEY);
    if (stored === __BUILD_VERSION__) return; // Same deploy

    // New deploy — clear data caches
    const prefixes = ['afrishop_cache:', 'afrishop_curated:'];
    const exactKeys = ['afrishop_recent_searches', 'afrishop_recently_viewed'];
    
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (prefixes.some(p => key.startsWith(p)) || exactKeys.includes(key)) {
        toRemove.push(key);
      }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
    localStorage.setItem(BUILD_KEY, __BUILD_VERSION__);
    
    console.log(`[CacheBust] Cleared ${toRemove.length} stale keys for new deploy`);
  } catch (e) {
    // localStorage unavailable — no-op
  }
}
```

## Files Changed

| File | Type | Change |
|------|------|--------|
| `vite.config.ts` | Modified | Add `define: { __BUILD_VERSION__ }` |
| `src/lib/cacheBust.ts` | New | Cache-bust utility |
| `src/main.tsx` | Modified | Call `bustStaleCache()` on startup |
| `src/lib/catalogCache.ts` | Modified | Bump prefix to v14 |

