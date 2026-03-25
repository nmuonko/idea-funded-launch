

# AfriShop Audit: Missing Features and Bugs

## Bugs Found

### 1. CategoryIconsRow ref warning (console error)
The `CategoryIconsRow` is a function component being passed a ref from `ShopHome` via `LazySection`. Function components cannot receive refs without `React.forwardRef()`. This produces the console warning you're seeing repeatedly.

**Fix**: Wrap `CategoryIconsRow` with `React.forwardRef` or remove the ref from its parent `LazySection` usage.

### 2. Discount codes exist in admin but are never applied at checkout
The admin panel (`FeesSettings.tsx`) lets you create discount/promo codes, but the checkout page (`Checkout.tsx`) has no input field for customers to enter a code. The codes are stored in `admin_settings.discount_codes` but never consumed anywhere in the purchase flow.

**Fix**: Add a promo code input to the checkout order summary section and validate it against stored codes before applying the discount.

### 3. Notifications toggle is purely cosmetic
In `Account.tsx`, the notifications switch uses local React state (`useState(true)`) and is never persisted to the database or connected to any notification system.

**Fix**: Either connect to a real notification preference table or remove the toggle to avoid misleading users.

---

## Missing Features for the Business Model

### 4. No promo code input at checkout (revenue driver)
As noted above, you have the admin infrastructure for discount codes but no customer-facing way to redeem them. This blocks promotional campaigns like "10% off your first order" or influencer codes.

### 5. No customer reviews or ratings system
Product detail pages display eBay/Amazon source ratings (`reviewCount`) but there's no way for AfriShop customers to leave their own reviews. Customer reviews build trust and increase conversion, especially for a cross-border commerce model where buyers need reassurance.

### 6. No order status email notifications
When an order transitions (PAID → PROCESSING → SHIPPED → DELIVERED), customers are not notified by email. Only the initial payment confirmation is sent. Shipping confirmation with tracking number and delivery updates are critical for cross-border orders that take longer.

### 7. No returns/refund request flow
The `/refunds` page explains the refund policy but there's no way for customers to actually submit a refund request through the app. They'd need to contact support manually via WhatsApp/email.

### 8. No SEO or social sharing metadata
Product pages and the homepage don't appear to have dynamic Open Graph / meta tags. When users share product links on WhatsApp or Facebook, there's no rich preview (title, image, price), which hurts organic viral growth — critical for your WhatsApp-first marketing strategy.

---

## Recommended Priority

| # | Item | Type | Business Impact |
|---|------|------|----------------|
| 1 | Fix CategoryIconsRow ref warning | Bug | Low (cosmetic) |
| 2 | Add promo code input at checkout | Bug + Feature | High (unlocks campaigns) |
| 3 | Order status email notifications | Feature | High (reduces support load) |
| 4 | Customer reviews system | Feature | Medium (trust + conversion) |
| 5 | Fix notification toggle | Bug | Low (misleading UX) |
| 6 | Returns/refund request form | Feature | Medium (customer experience) |
| 7 | Social sharing metadata | Feature | Medium (organic growth) |

Want me to implement any of these? I'd recommend starting with the promo code checkout integration since the backend is already built.

