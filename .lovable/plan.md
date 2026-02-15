
# Fix Account Menu Redundancy and Add Profile Navigation

## Problem
1. In the hamburger menu, there is a section header labeled "Account" and inside it a link also labeled "Account" -- this is redundant and confusing.
2. No user initials are shown in the menu to personalize it.
3. The Profile Settings page has no quick way to return to the homepage/main menu.

## Changes

### 1. ShopHeader.tsx -- Simplify the Account section
- Remove the "Account" section header (`<h3>`) entirely.
- Instead, when the user is logged in, show their **initials in a small avatar circle** followed by their name (or "My Account" fallback), linking to `/profile`.
- When not logged in, just show the Sign In link as before (no section header needed).

### 2. ShopHeader.tsx -- Add user initials at the bottom of the menu
- At the bottom of the menu (below Quick Links), show a small footer area with the user's avatar initials and email when logged in. This gives a personal touch.

### 3. Profile.tsx -- Add a "Return to Main Menu" button
- Add a back/home navigation link at the top of the Profile page (above the card) that takes the user back to the homepage (`/`). This will use an `ArrowLeft` icon with text like "Return to Main Menu" / "Retour au menu principal".

## Technical Details

### File: `src/components/shop/ShopHeader.tsx`
- Remove the `<h3>` "Account" section header (lines 74-76)
- Keep the link to `/profile` but change the label from `shop.accountTab` to something like the user's name or "My Profile"
- Show a small avatar with initials next to the link text
- Add a subtle user info footer at the bottom of the sheet (initials + email)

### File: `src/pages/Profile.tsx`
- Add a navigation link at the top of the page content: an `ArrowLeft` icon with "Return to Main Menu" that navigates to `/`
- Import `ArrowLeft` from lucide-react

## Files Changed
- `src/components/shop/ShopHeader.tsx` -- remove redundant Account header, add initials to account link, add user footer
- `src/pages/Profile.tsx` -- add "Return to Main Menu" link at top
