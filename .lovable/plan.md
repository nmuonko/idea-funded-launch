
# Fix: Cart Deletion Bug, Mobile Image Cropping, and Payment Page Translation

## Issue 1: Cart Deletion Bug (Critical)

**Root Cause:** When a logged-in user deletes a cart item, the system removes it from the screen instantly and then sends a server delete request. If that server request fails silently (e.g., expired auth token, network glitch), the item stays in the database. The "deleted item IDs" list is stored only in memory and survives for just 30 seconds. On page refresh, the memory is wiped and the item is fetched fresh from the server -- so it reappears.

Clearing cookies forces a fresh login, which gives a valid token, allowing the next delete to actually succeed.

**Fix:**
- In `src/contexts/ShopCartContext.tsx`:
  1. Persist `deletedItemIds` to `sessionStorage` (survives page refreshes within the same tab session, auto-clears when the tab closes)
  2. On init, load deleted IDs from sessionStorage so they survive refreshes
  3. When the server delete succeeds, immediately remove the ID from the persisted list (confirmed gone)
  4. When the server delete **fails**, show a toast error and restore the item to the UI (rollback)
  5. Extend the TTL from 30 seconds to 5 minutes to survive multiple sync cycles

## Issue 2: Mobile Product Image Cropping

**Root Cause:** On the product detail page (`ProductDetails.tsx`), the image container uses `aspect-square` which on mobile phones creates a very tall square. The image inside uses `object-contain p-8` which is correct, but the `aspect-square` ratio combined with the full-width container on narrow screens makes the image area dominate the viewport, appearing as a "big giant cropped picture."

The product cards on the grid (`ProductCard.tsx`) use `aspect-[4/3] sm:aspect-square` for non-compact mode which is already fine.

**Fix:**
- In `src/pages/shop/ProductDetails.tsx`:
  1. Change the hero image container from `aspect-square` to `aspect-[4/3] sm:aspect-square` on mobile -- this makes the image shorter on phones
  2. Reduce padding from `p-8` to `p-4 sm:p-8` on mobile for better image utilization

## Issue 3: Payment Pending Page Translation

**Root Cause:** The `PaymentPending.tsx` page has all text hardcoded in English with no i18n support.

**Fix:**
- Add translation keys for the payment pending page to `src/lib/i18n/translations.ts` for English, French, Swahili, and Lingala
- Update `src/pages/shop/PaymentPending.tsx` to use the translation system with `useLanguage()` and `translations`

New translation keys needed:
- `checkYourPhone` -- "Check Your Phone" / "Vérifiez votre téléphone"
- `paymentRequestSent` -- "A payment request has been sent to your mobile phone" / "Une demande de paiement a été envoyée sur votre téléphone"
- `ussdPrompt` -- "Please check your phone for the USSD prompt..." / "Veuillez vérifier votre téléphone..."
- `requestExpiry` -- "The request will expire in a few minutes..." / "La demande expirera dans quelques minutes..."
- `waitingConfirmation` -- "Waiting for confirmation..." / "En attente de confirmation..."
- `havingTrouble` -- "Having trouble? Contact support via WhatsApp" / "Un problème ? Contactez le support via WhatsApp"
- `amountToPay` -- "Amount to pay" / "Montant à payer"
- `backToOrders` -- "Back to Orders" / "Retour aux commandes"
- `tryAgain` -- "Try Again" / "Réessayer"
- `backToCheckout` -- "Back to Checkout" / "Retour au paiement"
- `orderProcessing` -- "We'll start processing your order right away." / "Nous commencerons à traiter votre commande immédiatement."

## Technical Summary

| File | Change |
|------|--------|
| `src/contexts/ShopCartContext.tsx` | Persist deleted IDs to sessionStorage; rollback on server failure; extend TTL to 5 min |
| `src/pages/shop/ProductDetails.tsx` | Change hero image from `aspect-square` to `aspect-[4/3] sm:aspect-square`; reduce mobile padding |
| `src/pages/shop/PaymentPending.tsx` | Add `useLanguage` + translation lookups for all hardcoded strings |
| `src/lib/i18n/translations.ts` | Add payment pending keys to en, fr, sw, and ln sections |

## Risk Assessment
- **Cart fix**: Low risk -- sessionStorage is well-supported and auto-clears. The rollback on failure is standard optimistic-update best practice.
- **Image fix**: Low risk -- only changes CSS aspect ratio on mobile breakpoint.
- **Translation**: Low risk -- additive change, English fallbacks ensure no breakage.
