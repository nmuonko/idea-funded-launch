

# Fix: Cart Items Disappearing on Mobile

## Root Cause Analysis

Two bugs cause items to vanish:

### Bug 1: In-flight add race condition
When a user adds two items quickly:
1. Item A added optimistically (`local_A`), server `add_item` starts
2. Item B added optimistically (`local_B`), server `add_item` starts  
3. A succeeds → `syncCart()` fires
4. `syncCart` gets server data (has A, but B hasn't been persisted yet)
5. Line 427: **"drop ALL local_ items unconditionally"** → `local_B` disappears
6. B succeeds → another `syncCart()` → B reappears (but user already thinks it's gone)

### Bug 2: Auth token refresh triggers full re-sync
- `AuthContext` calls `setUser(session?.user)` on every auth event, including `TOKEN_REFRESHED`
- This creates a new `user` object reference
- `syncCart` is a `useCallback` with `[user]` dependency → gets recreated
- The `useEffect` on line 459 depends on `[syncCart]` → re-triggers sync
- On mobile WebView, token refreshes happen more frequently (app backgrounding/foregrounding)
- Each unnecessary sync replaces all items with server data, dropping any in-flight optimistic items

## Fix (all in `src/contexts/ShopCartContext.tsx`)

### Fix 1: Track in-flight adds, preserve local items during sync
- Add an `addInFlightRef = useRef(0)` counter
- Increment before server `add_item` call, decrement in finally block
- In `syncCart`, if `addInFlightRef.current > 0`: merge server items with existing local_ items instead of dropping them
- This ensures `local_B` survives while its server call is still in progress

### Fix 2: Stop token refresh from triggering sync
- Change `syncCart` dependency from `[user]` to `[]` (it already uses `sessionRef` and checks `user` via closure)
- Or: change the useEffect trigger from `[userId, initialized, syncCart]` to `[userId, initialized]` and call `syncCart()` directly
- This prevents token refreshes from triggering unnecessary full syncs

### Fix 3: Increase sync delay guard
- Increase `ADD_SYNC_DELAY_MS` from 2000 to 3000ms as additional safety net for slow mobile connections

These three changes together ensure items only disappear when deliberately deleted by the user.

