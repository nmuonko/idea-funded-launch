

# Automated Link Validator + Price Sync + Mobile Polish

## What This Does

A scheduled background job will automatically check every product in your catalog to make sure:
- The link still works (item is available on eBay/Amazon)
- The price hasn't changed -- if it has, the database is updated immediately
- Broken/unavailable items are permanently removed (deactivated) after 3 consecutive failures

This runs automatically every 6 hours without any manual intervention.

For the mobile experience, several targeted improvements will make the app feel more polished on phones.

---

## Part 1: Enhanced Link Validator with Price Sync

### Current State
Your system already has a `link-check` mode in the refresh worker, but:
- It is **never scheduled** -- no cron job triggers it automatically
- When a product is still live, it only resets the fail counter -- it does **not check or update the price**
- It only works for eBay items

### Changes

**File: `supabase/functions/catalog-refresh-worker/index.ts`**

Update the `runLinkCheck` function (lines 1237-1244) so that when an item is confirmed active (HTTP 200), the response body is parsed to extract the current price. If the price differs from what's stored, update `price_usd` and `price_updated_at` in the database.

```text
Current behavior (item is live):
  -> Reset fail_count, update last_checked_at
  -> Done (price NOT checked)

New behavior (item is live):
  -> Parse response JSON for currentPrice
  -> If price changed: update price_usd, price_updated_at, data_updated_at
  -> Reset fail_count, update last_checked_at
  -> Track price_updates count in results
```

Also add a `deleted` counter: items deactivated due to 3+ failures are now reported as "removed" in logs/results.

**New cron job (via SQL insert tool):**

Schedule `link-check` to run every 6 hours with a batch of 200 items per run:

```text
Schedule: 0 */6 * * *  (every 6 hours at minute 0)
Calls: catalog-refresh-worker with mode=link-check, batch_size=200
```

This means the system will validate ~800 items per day. With the existing 7-day rotation window (`last_checked_at < 7 days ago`), the entire catalog cycles through validation regularly.

### Results Tracking

The function will return enhanced metrics:
- `checked` -- total items validated
- `active` -- confirmed still available
- `deactivated` -- removed (3+ failures)
- `price_updates` -- prices that changed and were updated
- `errors` -- items that couldn't be checked

---

## Part 2: Mobile Optimization Polish

The app is already well-structured for mobile (bottom nav, `pb-20` spacing, `overflow-x: hidden`, safe area insets). These are targeted improvements:

### 2a. Prevent iOS Auto-Zoom on Input Focus

**File: `src/index.css`**

Add a rule to prevent iOS Safari from zooming in when users tap on search or form inputs (happens when font-size is below 16px):

```css
@media screen and (max-width: 767px) {
  input, select, textarea {
    font-size: 16px !important;
  }
}
```

### 2b. Smooth Momentum Scrolling

**File: `src/index.css`**

Add `-webkit-overflow-scrolling: touch` for smooth inertial scrolling on older iOS devices, and `overscroll-behavior-y: contain` to prevent pull-to-refresh interference:

```css
html, body {
  -webkit-overflow-scrolling: touch;
  overscroll-behavior-y: contain;
}
```

### 2c. Touch Target Compliance

**File: `src/components/shop/BottomNavigation.tsx`**

Increase the nav icon area from `h-5 w-5` to `h-6 w-6` and ensure each tab's tap target meets the 44px minimum (currently flex-1 with `py-2` -- this is fine, but the icon itself is small). Add `min-h-[44px] min-w-[44px]` to the link wrapper.

### 2d. Cart Page Swipe-to-Delete Hint

**File: `src/pages/shop/ShopCart.tsx`**

Add a subtle "swipe left to remove" hint text on the first cart item for first-time users (stored in localStorage). This helps mobile users discover the delete gesture.

---

## Technical Summary

| File | Change |
|------|--------|
| `supabase/functions/catalog-refresh-worker/index.ts` | Parse price from eBay response on successful link check; update `price_usd` if changed |
| `src/index.css` | Add iOS zoom prevention, momentum scrolling, overscroll containment |
| `src/components/shop/BottomNavigation.tsx` | Increase touch targets to 44px minimum |
| Cron job (SQL insert) | Schedule `link-check` mode every 6 hours |

## Risk Assessment
- **Low risk**: The link-check enhancement only adds price parsing to an existing successful response path -- no new API calls
- **No user impact**: Runs in background; users see fresher prices and fewer broken links
- **Mobile CSS**: All changes are additive and scoped to mobile breakpoints

