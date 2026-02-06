
# Emergency Fix: Merge Mobile Sections Into Single Flat Feed

## Root Cause

The mobile app does NOT respect the `hideTitle: true` field. Setting `title: " "` also doesn't work because the app likely trims whitespace or falls back to `title_fr`/`title_en` from the section `key`. No matter what title value we send, the app renders section headers.

The `hideMobileTitles` transform was added to `mobileSectionsCache.ts` but the mobile app's rendering logic ignores the `hideTitle` flag entirely.

## Solution

Instead of trying to hide titles (which the app ignores), **merge all section items into a SINGLE flat section** so there are no category headers to display. This is the same pattern the web uses (one "featured" section).

## Changes (1 file)

### `supabase/functions/_shared/mobileSectionsCache.ts`

Replace the `hideMobileTitles` transform with a `flattenToSingleSection` transform:

- Collect all items from all sections into one array
- Return a SINGLE section with `key: "featured"`, `hideTitle: true`, `title: " "`
- The mobile app will render this as one continuous feed with no section headers
- Keep the same response shape (`ok`, `sections[]`, `page`, etc.)

This runs in all 3 response paths (cache hit, rebuild, empty fallback).

```text
Before (10 sections, each with title):
  sections: [
    { key: "phones", title: "Telephones", items: [...] },
    { key: "vehicles", title: "Vehicules", items: [...] },
    ...
  ]

After (1 section, no title):
  sections: [
    { key: "featured", hideTitle: true, title: " ", title_en: " ", title_fr: " ", items: [...all items merged...] }
  ]
```

### What does NOT change
- `catalog-home/index.ts` -- no changes
- `catalog-home-v2/index.ts` -- no changes
- Web UI / web response path -- completely untouched
- Payments, cart, checkout -- zero changes
- Product sourcing, caching, query logic -- zero changes
- The mobile sections cache still stores per-section data (for future use)
- Only the FINAL response transform changes

### Deploy
- Redeploy `catalog-home` and `catalog-home-v2` (they import the shared module)

### Expected Result
- Mobile homepage shows products as a continuous feed with NO section headers
- All products remain clickable and functional
- Payment flow untouched
- Web unchanged
