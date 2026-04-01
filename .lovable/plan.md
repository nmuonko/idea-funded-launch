

# Add TikTok Pixel to AfriShop

## What changes

**1 file: `index.html`**

### Change 1 — Update CSP (line 7)
The current Content-Security-Policy blocks external scripts not explicitly listed. TikTok's pixel loads from `https://analytics.tiktok.com`. Two CSP directives need updating:

- **`script-src`**: add `https://analytics.tiktok.com`
- **`connect-src`**: add `https://analytics.tiktok.com` (pixel sends tracking data back)

### Change 2 — Insert TikTok Pixel script in `<head>` (after line 7, before existing `<link>` tags)
Insert the exact pixel code provided, wrapped in the TikTok comment markers. The script is already async. Pixel ID: `D76IOI3C77U5P0Q2C2AG`. It calls `ttq.page()` immediately, so PageView fires on every page load.

## Why this works globally
`index.html` is the single entry point for the entire SPA — every route loads through it. No per-page insertion needed.

## What does NOT change
- No frontend component files touched
- No other scripts or styles modified
- No duplicate pixel — single insertion point

