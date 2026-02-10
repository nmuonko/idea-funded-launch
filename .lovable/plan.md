
# Fix Cart Reliability + Add Item Selection for Checkout

## Problems Identified

1. **Deleted items reappear**: When you add a new item, the code calls `syncCart()` which fetches ALL server-side cart items. If the delete hasn't fully completed on the server, or if there's a timing overlap, the deleted item comes back from the server response and overwrites your local state.

2. **Vehicle quotes block everything**: If your cart has a vehicle needing a quote, the entire checkout is blocked -- you can't pay for your non-vehicle items separately.

3. **No item selection**: Unlike the mobile app, the web cart doesn't let you select which items to pay for.

---

## Solution

### 1. Fix the "deleted items reappear" race condition

**File: `src/contexts/ShopCartContext.tsx`**

- Add a `deletedItemIds` set (React ref) that tracks IDs of items currently being deleted.
- In `removeItem`: add the item ID to this set BEFORE calling the server delete. Remove it from the set only after `syncCart` completes.
- In `syncCart`: after receiving server items, filter OUT any item whose ID is in the `deletedItemIds` set before calling `setItems`.
- In `addItem`: do NOT call `syncCart()` immediately after adding. Instead, just add locally and call the server add endpoint. Only sync after the server confirms (and still respect the deleted set).
- Remove the localStorage-to-state restore on init when user is logged in (server is the source of truth -- localStorage backup should only apply to guests).

### 2. Add item selection (checkboxes) to the cart page

**File: `src/pages/shop/ShopCart.tsx`**

- Add a `selectedItemIds` state (Set of item IDs), defaulting to all items selected.
- Each cart item row gets a checkbox.
- "Select All / Deselect All" toggle at the top.
- The Order Summary sidebar recalculates based on selected items only.
- The "Proceed to Checkout" button passes selected item IDs to the checkout page (via navigation state or context).
- Vehicle items can be deselected, allowing non-vehicle items to proceed to payment independently.

### 3. Update checkout to handle partial item selection

**Files: `src/contexts/ShopCartContext.tsx`, `src/pages/shop/Checkout.tsx`**

- Add `selectedItemIds` state to the cart context so it persists across navigation.
- Checkout page uses only the selected items for order creation and price display.
- The `mobile-create-order-from-cart` call will use the selected subset.
- Vehicle quote check applies only to selected items -- if no vehicle is selected, checkout proceeds normally.

### 4. Prevent localStorage from resurrecting items for logged-in users

**File: `src/contexts/ShopCartContext.tsx`**

- On init, if a user is logged in, skip loading from localStorage and wait for `syncCart` to provide the authoritative server state.
- Only persist to localStorage for guest users.

---

## Technical Details

### ShopCartContext changes

```text
New state/refs:
- deletedItemIdsRef = useRef<Set<string>>()
- selectedItemIds: Set<string> (exposed in context)
- toggleItemSelection(id): void
- selectAllItems(): void
- deselectAllItems(): void
- selectedItems: CartItem[] (computed)
- selectedTotalUsd: number (computed)

Modified functions:
- syncCart: filter out deletedItemIdsRef entries
- addItem: don't call syncCart inline; add server-side then merge ID
- removeItem: track in deletedItemIdsRef before server call
- init useEffect: skip localStorage load when user is logged in
```

### ShopCart.tsx (Cart Page) changes

```text
- Add Checkbox import
- Render checkbox per item row
- "Select All" / "Deselect All" button in header
- Order Summary uses selectedItems and selectedTotalUsd
- Vehicle quote warning only shows if a vehicle item is SELECTED
- "Proceed to Checkout" disabled if nothing selected
```

### Checkout.tsx changes

```text
- Read selectedItems from context instead of all items
- Vehicle blocking logic checks only selected items
- Order creation uses selected item IDs only
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/contexts/ShopCartContext.tsx` | Race condition fix, item selection state, skip localStorage for logged-in users |
| `src/pages/shop/ShopCart.tsx` | Add checkboxes, select all/none, recalculate summary from selection |
| `src/pages/shop/Checkout.tsx` | Use selected items only, partial vehicle blocking |
