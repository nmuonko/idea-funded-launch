

## Fix: False Vehicle Detection Blocking Mobile Money Payments

### Problem
Mobile money payments via PawaPay are being blocked with "provider not allowed" because the system is incorrectly flagging regular products as vehicles based on keywords found in item titles (e.g., "car" in "car charger", or "van" in "canvas").

The edge function logs confirm:
- `vehicleReasons: ["vehicle_keyword_in_title"]` -- only the title triggered it
- No explicit `is_vehicle` flag, no vehicle store, no vehicle URL
- Result: checkout returns `CHOICE_REQUIRED` with only `["STRIPE"]`, and `payments-create-intent` returns `PROVIDER_NOT_ALLOWED`

### Root Cause
In `supabase/functions/_shared/vehiclePaymentGuard.ts`, the `detectVehicleFromItems()` function uses `containsVehicleKeyword()` on item titles to flag items as vehicles. The keyword list includes common words like "car", "auto", "van", "truck" that can appear in non-vehicle product titles. While there are exclusions, they don't cover all cases.

### Solution
Make title-based vehicle detection non-blocking for payment routing. Title keyword detection alone should NOT block mobile money -- it should only be used for logging/analytics. Only explicit signals (is_vehicle flag, vehicle store, vehicle URL, vehicle fields like VIN/mileage) should block mobile money.

### Changes

**File: `supabase/functions/_shared/vehiclePaymentGuard.ts`**

1. Add a `confidence` level to vehicle detection results: `"high"` for explicit flags (is_vehicle, vehicle store, vehicle URL, vehicle fields) and `"low"` for title-keyword-only detection.

2. Update `detectVehicleFromItems()` return type to include a `confidence` field:
```text
return {
  isVehicle: vehicleItems.length > 0,
  confidence: hasHighConfidence ? 'high' : 'low',
  vehicleItems,
  reasons,
}
```

3. Title keyword detection (lines 288-292) will still flag the item but with low confidence.

**File: `supabase/functions/payments-create-intent/index.ts`**

4. Update the vehicle check (around line 334) to only block mobile money when vehicle detection confidence is `"high"`:
```text
// Only block mobile money for HIGH confidence vehicle detection
if (isVehicle && vehicleDetection.confidence === 'high') {
  // return PROVIDER_NOT_ALLOWED
}
// Low confidence (title keyword only) -- allow mobile money, just log a warning
```

**File: `supabase/functions/mobile-checkout/index.ts`**

5. Apply the same confidence check -- only route to STRIPE-only when confidence is high. Low-confidence detections should allow both MOBILE_MONEY and CARD options.

### Technical Details

The confidence classification:
- **High confidence** (blocks mobile money): `is_vehicle=true`, vehicle store (CARVANA, CARGURUS...), vehicle URL (carvana.com, cargurus.com...), vehicle fields (VIN, mileage, year, make, model), `vehicle_quote_applied=true`
- **Low confidence** (allows mobile money, logs warning): `vehicle_keyword_in_title` alone

This approach preserves vehicle detection for genuinely flagged vehicles while eliminating false positives from title keywords on regular products.

