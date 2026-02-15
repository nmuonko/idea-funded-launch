

# Remove Redundant Support Link from Quick Links

## What Changes

Remove the "Support" link (which navigates to `/support` -- the Customer Support Tickets page) from the Quick Links dropdown in the hamburger menu. Since there is already an in-app chat that auto-escalates to a live agent, the separate ticket page is redundant.

## Technical Details

### File: `src/components/shop/ShopHeader.tsx`

Remove lines 173-180 -- the `<Link to="/support">` block that shows the support/ticket page link under Quick Links. The remaining links (Home, My Orders, Favorites, Share & Earn) stay as-is.

## Files Changed
- `src/components/shop/ShopHeader.tsx` -- remove the `/support` link from Quick Links section

