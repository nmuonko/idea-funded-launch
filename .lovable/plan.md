
# Enhanced Web Shop Implementation - Mobile App Parity

This plan aligns the web shop with the comprehensive mobile app architecture documentation you provided, addressing authentication flows, UX patterns, and missing features.

---

## Current State Summary

| Feature | Status | Notes |
|---------|--------|-------|
| 5-Tab Bottom Navigation | ✅ Done | Browse, Cart, Saved, Orders, Account |
| Horizontal Product Rows | ✅ Done | With scroll arrows and fade overlays |
| Multi-Currency (USD + CDF) | ✅ Done | Exchange rate from config |
| Saved Items/Wishlist | ✅ Done | localStorage persistence |
| i18n (4 Languages) | ✅ Done | EN, FR, SW, LN |
| Guest Cart | ✅ Done | localStorage + merge on login |
| Checkout Flow | ✅ Partial | Missing mobile money selection UI |
| **Shop-Specific Auth** | ❌ Missing | Uses admin auth page |
| **Onboarding Screens** | ❌ Missing | No first-launch tutorial |
| **Recently Viewed** | ❌ Missing | No tracking |
| **Order Tracking UI** | ❌ Missing | No status timeline |
| **Footer (Web)** | ❌ Missing | No site footer |
| **Compare Products** | ❌ Missing | Not implemented |

---

## Implementation Plan

### Phase 1: Shop-Specific Authentication

**1.1 Create Welcome/Auth Screen for Shop**

Create a new shop-themed authentication page that matches the dark Tesla-inspired design.

**File:** `src/pages/shop/ShopAuth.tsx`

```text
Layout:
┌────────────────────────────────────────┐
│                                        │
│        [AfriShop Logo]                 │
│                                        │
│     Welcome to AfriShop                │
│   Shop USA, Deliver to DRC             │
│                                        │
│   ┌────────────────────────────┐       │
│   │    Create Account          │       │  ← Primary button
│   └────────────────────────────┘       │
│                                        │
│   ┌────────────────────────────┐       │
│   │       Sign In              │       │  ← Secondary outline
│   └────────────────────────────┘       │
│                                        │
│      Continue as Guest →               │  ← Text link to /shop
│                                        │
│   ─────────────────────────────       │
│   [🌐 English ▼] Language selector     │
│                                        │
└────────────────────────────────────────┘
```

Key features:
- Dark theme matching shop design
- Language selector at bottom
- "Continue as Guest" link
- Toggle between Sign In / Create Account modes
- Password visibility toggle
- Phone number field with country code selector
- Terms & Privacy checkbox for registration
- Email verification flow integration
- "Forgot Password" flow

**1.2 Create Registration Form**

Validation rules:
- Full name: Required, min 2 characters
- Email: Valid format, unique
- Phone: Valid DRC format (+243...)
- Password: Min 8 characters
- Confirm password: Must match

**1.3 Email Verification Screen**

After registration, show verification pending screen with:
- Email sent confirmation
- Resend verification button
- Check spam instructions
- Back to login link

---

### Phase 2: Onboarding Flow (First Launch)

**File:** `src/pages/shop/Onboarding.tsx`

Create a 3-step swipeable onboarding screen for first-time visitors:

```text
Screen 1: "Shop Top US Stores"
- Illustration of Amazon/eBay logos
- "Browse thousands of products from top US retailers"

Screen 2: "Easy Checkout"
- Illustration of cart/payment
- "Multiple payment options including Mobile Money"

Screen 3: "Fast Delivery to DRC"
- Illustration of shipping
- "We handle everything - shipping right to your door"
```

Features:
- Dot indicators (● ○ ○)
- Skip button on all screens
- Next button transitions
- "Start Shopping" on final screen
- Save completion to localStorage: `afrishop_onboarding_complete`
- Check this flag in ShopHome and redirect if not completed

---

### Phase 3: Recently Viewed Products

**3.1 Update ShopCartContext**

Add recently viewed tracking:

```typescript
// Add to ShopCartContext
recentlyViewed: Product[];
addRecentlyViewed: (product: Product) => void;
clearRecentlyViewed: () => void;
```

Storage key: `afrishop_recently_viewed`
Max items: 20
Deduplication: Remove existing before adding to front

**3.2 Add Recently Viewed Section to ShopHome**

Display as horizontal scroll row between Featured Carousel and product sections:

```text
┌────────────────────────────────────────┐
│ Recently Viewed            Clear All → │
├────────────────────────────────────────┤
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐    │
│ │    │ │    │ │    │ │    │ │    │    │
│ │$299│ │$499│ │$199│ │$399│ │$599│    │
│ └────┘ └────┘ └────┘ └────┘ └────┘    │
└────────────────────────────────────────┘
```

**3.3 Track Views in ProductDetails**

Add to ProductDetails.tsx useEffect:
- Extract product data when loaded
- Call `addRecentlyViewed()` with product info

---

### Phase 4: Enhanced Order History & Tracking

**4.1 Update MyOrders.tsx**

Add order status timeline visualization:

```text
┌────────────────────────────────────────┐
│ Order #AF-2024-001234                  │
├────────────────────────────────────────┤
│ Status: Processing                     │
│ ━━━━━●━━━━━━━━━━━━━━━━━━              │
│ Paid → Processing → Shipped → Delivered│
├────────────────────────────────────────┤
│ Items (tap to expand)                  │
│ ┌──────────────────────────┐           │
│ │ [img] iPhone 16 Pro  x1  │           │
│ │       $764.97            │           │
│ └──────────────────────────┘           │
├────────────────────────────────────────┤
│ Shipping Address                       │
│ John Doe                               │
│ 123 Peace Avenue, Kinshasa             │
├────────────────────────────────────────┤
│ [Contact Support]                      │
└────────────────────────────────────────┘
```

**4.2 Add Order Status Colors**

| Status | Color | Icon |
|--------|-------|------|
| pending | Gray | Clock |
| paid | Green | CheckCircle |
| processing | Blue | Package |
| shipped | Orange | Truck |
| delivered | Green | CheckCircle2 |
| cancelled | Red | XCircle |

---

### Phase 5: Mobile Money Selection UI

**File:** `src/components/shop/MobileMoneySelector.tsx`

Update Checkout.tsx payment method section:

```text
┌────────────────────────────────────────┐
│ Select Mobile Money Provider           │
├────────────────────────────────────────┤
│ ┌──────────────────────────────────┐   │
│ │ 🟠 Orange Money              ○   │   │
│ └──────────────────────────────────┘   │
│ ┌──────────────────────────────────┐   │
│ │ 🔴 Airtel Money              ○   │   │
│ └──────────────────────────────────┘   │
│ ┌──────────────────────────────────┐   │
│ │ 🔵 M-Pesa                    ○   │   │
│ └──────────────────────────────────┘   │
│ ┌──────────────────────────────────┐   │
│ │ 🟢 Vodacom M-Pesa            ○   │   │
│ └──────────────────────────────────┘   │
│                                        │
│ You'll receive a push notification     │
│ to confirm on your phone.              │
└────────────────────────────────────────┘
```

---

### Phase 6: Web Footer

**File:** `src/components/shop/ShopFooter.tsx`

```text
┌────────────────────────────────────────────────────────────────┐
│ AfriShop                                                       │
│ Shop USA, Deliver to Africa                                    │
├────────────────────────────────────────────────────────────────┤
│ Shop          Support         Legal           Follow Us        │
│ Categories    Help Center     Terms           Facebook         │
│ New Arrivals  Contact Us      Privacy         Instagram        │
│ Deals         FAQs            Refund Policy   Twitter          │
├────────────────────────────────────────────────────────────────┤
│ © 2026 AfriShop. All rights reserved.    [🌐 English ▼]       │
└────────────────────────────────────────────────────────────────┘
```

Features:
- Responsive grid layout
- Language selector
- Social media links
- Legal page links
- Support contact info

---

### Phase 7: Auth i18n Translations

Add to `translations.ts` for all 4 languages:

```typescript
auth: {
  welcome: "Welcome to AfriShop",
  tagline: "Shop USA, Deliver to DRC",
  createAccount: "Create Account",
  signIn: "Sign In",
  continueAsGuest: "Continue as Guest",
  email: "Email",
  password: "Password",
  confirmPassword: "Confirm Password",
  fullName: "Full Name",
  phone: "Phone Number",
  forgotPassword: "Forgot Password?",
  resetPassword: "Reset Password",
  sendResetLink: "Send Reset Link",
  noAccount: "Don't have an account?",
  hasAccount: "Already have an account?",
  termsAgree: "I agree to the Terms of Service and Privacy Policy",
  verifyEmail: "Verify Your Email",
  verifyEmailSent: "We sent a verification link to your email",
  resendVerification: "Resend Verification",
  checkSpam: "Check your spam folder if you don't see it",
  passwordTooShort: "Password must be at least 8 characters",
  passwordMismatch: "Passwords do not match",
  invalidEmail: "Please enter a valid email address",
  invalidCredentials: "Invalid email or password",
}
```

---

### Phase 8: Keyboard Shortcuts (Web)

Add keyboard navigation to ShopHome:

| Shortcut | Action |
|----------|--------|
| `/` or `Cmd+K` | Focus search bar |
| `Esc` | Close modals/drawers |
| `Enter` | Submit forms |
| `←` / `→` | Navigate image gallery |

Implementation in `src/hooks/useKeyboardShortcuts.ts`

---

### Phase 9: Mini Cart Preview (Desktop Hover)

**File:** `src/components/shop/MiniCartPreview.tsx`

On desktop, hovering over the cart icon shows a dropdown preview:

```text
┌────────────────────────────────┐
│ Your Cart (3 items)            │
├────────────────────────────────┤
│ [img] iPhone 16...   $764.97   │
│ [img] AirPods...     $249.00   │
│ [img] Case...         $29.99   │
├────────────────────────────────┤
│ Subtotal:          $1,043.96   │
│ [View Cart]  [Checkout]        │
└────────────────────────────────┘
```

Integrate with ShopHeader cart button using Radix HoverCard.

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/pages/shop/ShopAuth.tsx` | Shop-themed authentication page |
| `src/pages/shop/Onboarding.tsx` | First-launch tutorial screens |
| `src/components/shop/ShopFooter.tsx` | Site footer for web |
| `src/components/shop/MobileMoneySelector.tsx` | Payment provider selection |
| `src/components/shop/MiniCartPreview.tsx` | Desktop cart hover preview |
| `src/components/shop/OrderStatusTimeline.tsx` | Visual order progress |
| `src/hooks/useKeyboardShortcuts.ts` | Keyboard navigation |
| `src/hooks/useRecentlyViewed.ts` | Recently viewed products |

## Files to Modify

| File | Changes |
|------|---------|
| `src/contexts/ShopCartContext.tsx` | Add recentlyViewed state |
| `src/pages/shop/ShopHome.tsx` | Add Recently Viewed section, onboarding redirect |
| `src/pages/shop/ProductDetails.tsx` | Track recently viewed |
| `src/pages/shop/MyOrders.tsx` | Add status timeline, order detail view |
| `src/pages/shop/Checkout.tsx` | Integrate MobileMoneySelector |
| `src/components/shop/ShopHeader.tsx` | Add MiniCartPreview on desktop |
| `src/lib/i18n/translations.ts` | Add auth translations |
| `src/App.tsx` | Add new routes for ShopAuth, Onboarding |

---

## Route Changes

```typescript
// Add to App.tsx
<Route path="/shop/auth" element={<ShopAuth />} />
<Route path="/shop/onboarding" element={<Onboarding />} />
<Route path="/shop/orders/:orderId" element={<ShopOrderDetail />} />
```

---

## Priority Order

1. **Shop Authentication** (Phase 1) - Critical for user onboarding
2. **Auth i18n** (Phase 7) - Required for Phase 1
3. **Order Status Timeline** (Phase 4) - Important UX improvement
4. **Recently Viewed** (Phase 3) - Common e-commerce feature
5. **Mobile Money UI** (Phase 5) - Payment UX improvement
6. **Onboarding** (Phase 2) - Nice-to-have for first-time users
7. **Footer** (Phase 6) - Web-specific enhancement
8. **Mini Cart** (Phase 9) - Desktop UX polish
9. **Keyboard Shortcuts** (Phase 8) - Power user feature

---

## Expected Outcome

After implementation:
1. Shop has its own branded authentication flow separate from admin
2. First-time users see an onboarding tutorial
3. Users can track their recently viewed products
4. Orders display visual status timelines
5. Mobile money provider selection is clearer
6. Desktop users get cart preview on hover
7. All new UI elements support 4 languages
8. Web footer provides site navigation and legal links
