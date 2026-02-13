
# Add Terms & Conditions Popup Before Checkout

## What Changes

Replace the small, easy-to-miss checkbox at the bottom of the checkout page with a prominent popup dialog that appears when the user clicks "Place Order." The dialog will clearly display the terms acceptance requirement, with Accept and Decline buttons.

## How It Works

1. Remove the `termsAccepted` checkbox and its surrounding markup from the bottom of the form (lines 611-630).
2. Remove the `disabled={!termsAccepted}` condition from the "Place Order" button so it is always clickable.
3. When the user clicks "Place Order":
   - If terms have NOT been accepted yet, show a Dialog popup instead of submitting.
   - The popup displays a clear message: "Please review and accept our Terms of Service and Privacy Policy to complete your order."
   - It includes links to `/terms` and `/privacy`.
   - Two buttons: "Decline" (closes the dialog) and "Accept & Continue" (sets `termsAccepted = true` and submits the form).
   - If terms HAVE already been accepted (user accepted earlier in the session), submit directly.

## User Experience

- User fills in address and payment method, clicks "Place Order."
- A centered popup appears asking them to accept terms.
- They click "Accept & Continue" -- the order submits immediately.
- If they click "Decline," the popup closes and nothing happens.
- Once accepted in a session, subsequent order attempts skip the popup.

---

## Technical Details

### File: `src/pages/shop/Checkout.tsx`

**Remove** (lines 611-630): The existing checkbox + label block for terms.

**Add state**: `showTermsDialog` (boolean, default false).

**Modify `handleSubmit`**: At the top, before the existing terms check, if `!termsAccepted`, call `setShowTermsDialog(true)` and return early (don't show a toast).

**Add new function** `handleAcceptTerms`: Sets `termsAccepted = true`, closes the dialog, and programmatically submits the form by calling the core checkout logic.

**Add Dialog component** (using the existing `src/components/ui/dialog.tsx`):
- Rendered at the bottom of the JSX, outside the form.
- `open={showTermsDialog}`, `onOpenChange={setShowTermsDialog}`.
- Contains title, description with links, and two buttons.

**Update "Place Order" button**: Remove `disabled={!termsAccepted}` -- keep only `disabled={loading}`.

### No new files or dependencies needed
- Uses the existing `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter` from `@/components/ui/dialog`.
