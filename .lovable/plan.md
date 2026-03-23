
Diagnosis

I checked the backend data and code path, and the current evidence points away from profile/phone issues:

- Both affected users now have complete profiles, including phone and country:
  - ngoyprecious@gmail.com
  - kabuyachadrack94@gmail.com
- Both users also have active DRAFT orders with order_items already created.
- But they have no checkout_sessions and no payment_attempts, which means checkout is failing before payment initialization/finalization.
- The screenshot error text matches the generic failure returned by `mobile-checkout` when it cannot finish building the checkout order.

What stands out in their data:
- Their `orders` rows have totals (`item_total_usd`, `shipping_fee_usd`, `total_usd`, `total_cdf`)
- But their `order_items` rows are incomplete: key copied pricing fields are `null` (`unit_price_usd`, `subtotal_usd`, `markup_fee_usd`, `shipping_fee_usd`, `total_price_usd`, `total_price_cdf`)

That is the strongest likely cause:
- `mobile-checkout` copies `order_items` into a new checkout order
- for these users, the source items are missing pricing fields
- that path returns the exact generic “Failed to process checkout. Please try again.” error
- future users can hit the same issue if their cart/order items are created through the same incomplete path

Implementation plan

1. Harden `mobile-checkout` against incomplete legacy cart/order items
- Before copying items into the checkout order, normalize each source item.
- If `unit_price_usd`, `subtotal_usd`, `markup_fee_usd`, `shipping_fee_usd`, or `total_price_usd` are null, recompute them from:
  - `base_price_usd`
  - quantity
  - current checkout totals/settings already loaded in the function
- Use the normalized values for the copied checkout items instead of raw nullable source fields.

2. Add a server-side fallback for malformed cart item IDs / stale item snapshots
- Keep the existing cart desync recovery, but also make the later copy step use the validated/recovered DB items rather than re-querying raw `cart_item_ids` again.
- This prevents a second failure when the frozen RN app sends stale IDs.

3. Make all mobile-checkout failures follow the frozen mobile contract
- Replace the remaining 500 responses in `mobile-checkout` with HTTP 200 structured JSON errors.
- Include stable error codes like:
  - `CHECKOUT_ITEM_FETCH_FAILED`
  - `CHECKOUT_ITEM_COPY_FAILED`
  - `CHECKOUT_ITEM_NORMALIZATION_FAILED`
- This prevents the app from collapsing everything into one generic failure and makes future diagnosis easier.

4. Add targeted diagnostics to isolate affected users cleanly
- Log:
  - user id
  - source order id
  - requested cart item ids
  - recovered DB item ids
  - whether any source pricing fields were null
  - which normalization fallback was used
- This is important because the current logs are not giving enough actionable detail for these failures.

5. Protect future users at the cart/order creation layer
- Trace where these incomplete `order_items` are originally created.
- Ensure that when cart/order items are inserted, pricing columns are populated consistently instead of relying on later checkout logic.
- This prevents the bad state from being created in the first place.

Technical details

Likely failing area:
- `supabase/functions/mobile-checkout/index.ts`
- The generic error in the screenshot matches the branches that return:
  - `Failed to process checkout. Please try again.`
- Those branches occur during item fetch/copy into the new checkout order.

Why this is the right fix:
- The users are authenticated enough to have profiles and DRAFT orders
- They never reach payment attempt creation
- Their cart source data is materially different from a healthy checkout record because the item-level monetary fields are null
- Fixing only auth or profiles will not solve this class of failure

Files / areas to update
- `supabase/functions/mobile-checkout/index.ts`
- The function/path that creates cart/order items for mobile users (to stop writing incomplete item rows)

Expected result after implementation
- These two affected users should be able to check out without needing a new login
- Future users with partially populated cart rows will still be recoverable at checkout
- Future debugging will show a specific code instead of a generic checkout failure
