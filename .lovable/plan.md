

# Fix: Mobile Cart Buttons Not Working - "Requested function was not found"

## Problem Identified

Multiple critical mobile cart edge functions are **NOT DEPLOYED** (returning 404 errors):

| Function | Status | Lines | Purpose |
|----------|--------|-------|---------|
| `mobile-add-cart-item` | ❌ NOT DEPLOYED | 1106 | Add items to cart |
| `mobile-get-cart` | ❌ NOT DEPLOYED | 596 | Fetch cart contents |
| `mobile-update-cart-item` | ❌ NOT DEPLOYED | 400 | Update item quantity |
| `mobile-delete-cart-item` | ❌ NOT DEPLOYED | 180 | Remove items from cart |
| `mobile-create-order-from-cart` | ❌ NOT DEPLOYED | 306 | Create order from cart |
| `mobile-checkout` | ❌ NOT DEPLOYED | 2304 | Checkout process |

The code for all these functions exists in the repository but they were never deployed to the Supabase Edge Functions runtime.

## Root Cause

These functions were either:
1. Never deployed after being created
2. Deleted during the previous deployment attempts when `catalog-search` was causing issues

## Solution

Deploy all mobile cart-related edge functions.

## Changes Required

### Deploy Edge Functions (in order of criticality)

**Phase 1 - Core Cart Functions (smaller, should deploy quickly):**
1. `mobile-delete-cart-item` (180 lines) - smallest, deploy first
2. `mobile-create-order-from-cart` (306 lines)
3. `mobile-update-cart-item` (400 lines)
4. `mobile-get-cart` (596 lines)

**Phase 2 - Add to Cart (medium size):**
5. `mobile-add-cart-item` (1106 lines) - this is the specific function causing the error

**Phase 3 - Checkout (large, may timeout):**
6. `mobile-checkout` (2304 lines) - **WARNING**: This is larger than `catalog-search` which times out. May need refactoring if deployment fails.

## Deployment Risk Assessment

| Function | Lines | Risk Level |
|----------|-------|------------|
| `mobile-delete-cart-item` | 180 | ✅ Low - should deploy instantly |
| `mobile-create-order-from-cart` | 306 | ✅ Low |
| `mobile-update-cart-item` | 400 | ✅ Low |
| `mobile-get-cart` | 596 | ✅ Low |
| `mobile-add-cart-item` | 1106 | ⚠️ Medium - larger but should work |
| `mobile-checkout` | 2304 | ❌ HIGH - may timeout like catalog-search |

## Expected Outcome

After deployment:
- ✅ "Add to Cart" buttons will work on mobile
- ✅ Cart management (view, update, delete) will work
- ✅ Order creation will work
- ⚠️ Checkout may still have issues if `mobile-checkout` times out during deployment

## Fallback Plan

If `mobile-checkout` deployment times out:
1. Cart functionality will still work (add, view, update, delete)
2. The checkout function would need to be refactored into smaller modules in a future session

