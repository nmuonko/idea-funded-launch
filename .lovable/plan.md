

# Make Referral Button Visible on Homepage (All Devices)

## Current Behavior
- The floating gift button (ReferralFAB) is only visible on **mobile** (`md:hidden` hides it on desktop/tablet)
- It appears on every page except `/account`

## Proposed Change

### File: `src/components/shop/ReferralFAB.tsx`

Remove the `md:hidden` class from the button so it appears on **all screen sizes** (mobile, tablet, and desktop). This single class removal makes the pulsing gift icon visible to every user on every device, including the homepage.

The button will continue to:
- Hide on the `/account` page (where InviteEarn is already shown inline)
- Open a bottom drawer with the referral registration form when tapped
- Pulse with the orange-to-pink gradient to attract attention

On desktop, the button position will be adjusted slightly (e.g., `bottom-8 right-8`) so it sits comfortably in the corner without overlapping the bottom nav (which is mobile-only).

```tsx
<button
  className="fixed bottom-20 md:bottom-8 right-4 md:right-8 z-50 h-12 w-12 rounded-full bg-gradient-to-br from-orange-500 to-pink-500 shadow-lg flex items-center justify-center text-white animate-pulse hover:scale-110 transition-transform"
  aria-label="Partager & Gagner"
>
```

## Summary
- **1 file** changed: `src/components/shop/ReferralFAB.tsx`
- Remove `md:hidden` so the button is visible on all devices
- Adjust positioning for desktop (`bottom-8 right-8` instead of `bottom-20`) since desktop has no bottom nav bar

