

# Regression Fixes -- Exact Changes

## Fix 1: CRITICAL -- verify-payment crash on failed payments

**File:** `supabase/functions/verify-payment/index.ts`, line 333

Change `paymentStatus: maishapayStatus` to `paymentStatus: normalizedStatus`

Then redeploy the `verify-payment` edge function.

## Fix 2: CRITICAL -- Stripe redirect to wrong route

**File:** `src/pages/shop/CardPayment.tsx`

- Line 121: Change `/shop/payment-success?order_id=` to `/payment-success-shop?order_id=`
- Line 133: Change `/shop/payment-success?order_id=` to `/payment-success-shop?order_id=`

## Fix 3: Remove legacy paths from environment.ts

**File:** `src/lib/environment.ts`, line 31

Remove `/bank-transfer`, `/manual-transfer`, `/maishapay` from the `excludedPaths` array.

## Fix 4: Clean up translation strings (all 4 languages)

**File:** `src/lib/i18n/translations.ts`

| Line | Old | New |
|------|-----|-----|
| 384 | `Pay with Mobile Money, Card, or Bank Transfer` | `Pay with Mobile Money or Card` |
| 428 | `card, mobile money, or bank transfer` | `card or mobile money` |
| 1846 | `Bank Transfer` | `Payments` |
| 1944 | `Track and manage MaishaPay transactions` | `Track and manage payment transactions` |
| 1954 | `View and manage MaishaPay payment records` | `View and manage payment records` |
| 1959 | `MaishaPay Ref` | `Payment Ref` |
| 2411 | `Virement bancaire` | `Paiements` |
| 2509 | `transactions MaishaPay` | `transactions de paiement` |
| 2518 | `paiement MaishaPay` | `paiement` |
| 2523 | `Réf MaishaPay` | `Réf paiement` |
| 2960 | `Uhamisho wa benki` | `Malipo` |
| 3058 | `shughuli za MaishaPay` | `shughuli za malipo` |
| 3067 | `malipo za MaishaPay` | `malipo` |
| 3072 | `Ref ya MaishaPay` | `Ref ya malipo` |
| 3509 | `Virement bancaire` | `Mafuta` |
| 3607 | `transactions ya MaishaPay` | `transactions ya mafuta` |
| 3616 | `mafuta ya MaishaPay` | `mafuta` |
| 3621 | `Réf MaishaPay` | `Réf mafuta` |

## Execution Order

1. Fix verify-payment (line 333)
2. Fix CardPayment.tsx (lines 121, 133)
3. Update environment.ts (line 31)
4. Update translations.ts (18 lines across 4 languages)
5. Deploy verify-payment edge function

