

# Add Global Floating "Partager & Gagner" Button

## Approach

Add a small floating gift button **above the bottom navigation bar** on every page. Since `BottomNavigation` is already rendered on all 7 shop pages, placing the floating button inside it means zero changes to individual pages.

Tapping the button opens a bottom sheet (using Vaul's `Drawer`) containing the existing `InviteEarn` component.

## Changes

### 1. New Component: `src/components/shop/ReferralFAB.tsx`

A floating action button (FAB) positioned just above the bottom nav bar:
- Small circular button with a Gift icon and a pulsing orange gradient
- On tap, opens a `Drawer` (bottom sheet) with the full `InviteEarn` registration/share form
- Uses existing `InviteEarn` component inside the drawer -- no duplication of logic
- Respects the current language setting
- Hidden on the `/account` page (since InviteEarn is already shown there inline)

### 2. Modified: `src/components/shop/BottomNavigation.tsx`

- Import and render `ReferralFAB` just above the nav bar
- No other changes to navigation logic

### No backend changes needed

The existing `create-referrer` edge function and `InviteEarn` component handle all referral logic. This is purely a UI visibility improvement.
