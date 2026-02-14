

# Make the "Request a Quote" Button Prominent in Cart

## Problem

The "Request a Quote" button in the cart is too small (`size="sm"`, `h-8`, `text-xs`) and blends in with badges. Additionally, for vehicles where a quote was already sent from the product details page previously, it shows "Quote Pending" -- which is correct server state, but the user expects to control this from the cart.

**Note:** For the vehicle currently in your cart, a quote was already requested in a prior session (the server already has status "pending"). The button WILL appear for any **new** vehicle you add to cart going forward. The code logic is correct -- we just need to make the button much more visible.

## Changes: `src/pages/shop/ShopCart.tsx`

Make the "Request a Quote" button highly visible:

1. **Increase button size** -- change from `size="sm"` / `h-8 text-xs` to a full-width, taller button (`w-full h-10 text-sm font-semibold`) with a pulsing animation to draw attention
2. **Add an attention-grabbing wrapper** -- wrap the button area in a highlighted container with a subtle amber border/glow so it stands out from the rest of the card
3. **Make "Quote Pending" also more visible** -- upgrade from a tiny badge to a styled status bar so users can clearly see the state

The button hierarchy will be:
- `vehicleQuoteStatus === 'none'`: Large amber gradient button with pulse effect -- "Request a Quote"
- `vehicleQuoteStatus === 'pending'`: Amber outlined status bar -- "Quote Pending - You'll be notified"  
- `vehicleQuoteStatus === 'quoted'`: Green status bar -- "Quote Received"

## Technical Details

### File Modified
- `src/pages/shop/ShopCart.tsx` (lines 199-230) -- Resize and restyle the inline quote button and status indicators

### No backend changes needed
The quote flow is already working correctly. This is purely a visibility/styling improvement.
