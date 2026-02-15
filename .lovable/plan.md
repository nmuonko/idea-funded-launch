
# Move Referral Button to Avoid Chat Icon Overlap

## Problem

Both the referral gift button and the in-app chat icon sit in the bottom-right corner:
- **Chat widget**: `bottom-28 right-4` (mobile) / `bottom-6 right-6` (desktop)
- **Referral FAB**: `bottom-20 right-4` (mobile) / `bottom-8 right-8` (desktop)

They overlap on both mobile and desktop.

## Solution

Move the referral button to the **bottom-left** corner. This cleanly separates the two buttons -- chat stays bottom-right, referral goes bottom-left. No risk of overlap with any right-side elements.

### File: `src/components/shop/ReferralFAB.tsx`

Change the button positioning from `right-4 md:right-8` to `left-4 md:left-8`:

```tsx
<button
  className="fixed bottom-20 md:bottom-8 left-4 md:left-8 z-50 h-12 w-12 rounded-full bg-gradient-to-br from-orange-500 to-pink-500 shadow-lg flex items-center justify-center text-white animate-pulse hover:scale-110 transition-transform"
  aria-label="Partager & Gagner"
>
```

This keeps it above the bottom nav on mobile (`bottom-20`) and in the lower-left on desktop (`bottom-8 left-8`).

## Summary
- **1 file** changed: `src/components/shop/ReferralFAB.tsx`
- Move from right side to left side to avoid overlap with the chat icon
