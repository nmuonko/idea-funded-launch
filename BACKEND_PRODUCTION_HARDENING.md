# Backend Production Hardening Documentation

## Overview

This document describes the backend hardening changes for production readiness:
- Email verification enforcement for checkout
- Guest cart merge to user cart (silent, idempotent)
- Store visit frequency tracking (per user/device)
- Recently viewed items (per user/device, never global)
- Favorites deprecation (no favorites tables existed)

**Important:** Stripe and pawaPay payment logic remains unchanged.

---

## A) Email Verification Enforcement

### Function: `public.is_email_verified()`

Returns `true` if the current authenticated user has a verified email (`email_confirmed_at IS NOT NULL`).

```sql
SELECT public.is_email_verified();
-- Returns: true | false
```

### RLS Policies Updated

The following tables now require email verification for INSERT operations:

| Table | Policy |
|-------|--------|
| `orders` | Users can only insert orders if `is_email_verified() = true` |
| `checkout_sessions` | Users can only create checkout sessions if `is_email_verified() = true` |
| `payment_attempts` | Users can only create payment attempts if `is_email_verified() = true` |

### Error Code

When a checkout/order/payment attempt fails due to unverified email:

```json
{
  "success": false,
  "code": "EMAIL_NOT_VERIFIED",
  "message": "Email verification required for checkout"
}
```

**Note:** Edge functions that create orders/checkouts should catch RLS violations and return this standardized error.

---

## B) Guest Cart Merge

### Overview

When a guest user browses and adds items to cart, those items are stored locally on the mobile device. When they sign up, verify email, and log in, the cart should seamlessly merge.

### Endpoint: `POST /functions/v1/cart-guest-snapshot`

Saves guest cart state to the server for later merge.

**Request:**
```json
{
  "device_id": "device-uuid",
  "cart": [
    {
      "productUrl": "https://amazon.com/dp/B123...",
      "title": "Product Name",
      "imageUrl": "https://...",
      "store": "amazon",
      "unitPrice": 29.99,
      "quantity": 2,
      "currency": "USD"
    }
  ]
}
```

**Response (success):**
```json
{
  "success": true,
  "message": "Cart snapshot saved",
  "item_count": 1
}
```

### Endpoint: `POST /functions/v1/merge-guest-cart`

Merges guest cart items into the authenticated user's cart. **Requires authentication.**

**Request:**
```json
{
  "guest_device_id": "device-uuid",
  "guest_items": [
    {
      "productUrl": "https://amazon.com/dp/B123...",
      "title": "Product Name",
      "imageUrl": "https://...",
      "store": "amazon",
      "unitPrice": 29.99,
      "quantity": 2,
      "currency": "USD"
    }
  ],
  "idempotency_key": "unique-key-for-request"
}
```

**Headers:**
```
Authorization: Bearer <user-jwt>
```

**Response (success):**
```json
{
  "success": true,
  "merged_count": 1,
  "skipped_count": 0,
  "cart_id": "uuid",
  "totals": {
    "item_total_usd": 29.99,
    "shipping_fee_usd": 15.00,
    "total_usd": 64.98,
    "total_cdf": 162450,
    "requires_manual_quote": false
  },
  "message": "Successfully merged 1 item(s) into your cart"
}
```

**Response (idempotent - already processed):**
```json
{
  "success": true,
  "idempotent": true,
  "merged_count": 0,
  "message": "Request already processed (idempotent)"
}
```

### Table: `guest_cart_snapshots`

| Column | Type | Description |
|--------|------|-------------|
| device_id | text | Primary key, device identifier |
| cart_json | jsonb | Cart items as JSON array |
| created_at | timestamptz | Record creation time |
| updated_at | timestamptz | Last update time |

**RLS Policy:** No direct client access (service role only via edge functions).

### Flow

1. Guest browses and adds items to local cart
2. Mobile app periodically calls `cart-guest-snapshot` to backup cart
3. User signs up and verifies email
4. On login, mobile app calls `merge-guest-cart` with local cart items
5. Items are merged into user's DRAFT order (idempotent - safe to retry)
6. Guest snapshot can be cleared after successful merge

---

## C) Store Visit Tracking

### Endpoint: `POST /functions/v1/track-store-visit`

Tracks store visits per user (if authenticated) and device.

**Request:**
```json
{
  "store_id": "amazon",
  "device_id": "device-uuid-or-fingerprint"
}
```

**Headers (optional):**
```
Authorization: Bearer <user-jwt>
```

**Response (success):**
```json
{
  "success": true,
  "visit_count": 5,
  "id": "uuid"
}
```

**Response (error):**
```json
{
  "success": false,
  "code": "INVALID_STORE_ID",
  "message": "store_id is required"
}
```

### Table: `store_visit_counts`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | Nullable, auth.users reference |
| device_id | text | Device identifier |
| store_id | text | Store identifier (e.g., "amazon") |
| visit_count | integer | Incremented on each visit |
| last_visited_at | timestamptz | Last visit timestamp |
| created_at | timestamptz | Record creation time |
| updated_at | timestamptz | Last update time |

**Unique constraint:** `(COALESCE(user_id::text, ''), device_id, store_id)`

---

## D) Recently Viewed Items

### Endpoint: `POST /functions/v1/recently-viewed-upsert`

Upserts a recently viewed product.

**Request:**
```json
{
  "device_id": "device-uuid",
  "store_id": "amazon",
  "product_url": "https://amazon.com/dp/B123...",
  "title": "Product Name",
  "image_url": "https://..."
}
```

**Headers (optional):**
```
Authorization: Bearer <user-jwt>
```

**Response:**
```json
{
  "success": true,
  "view_count": 3,
  "id": "uuid"
}
```

### Endpoint: `GET /functions/v1/recently-viewed-list`

Fetches recently viewed items for a user/device.

**Query Parameters:**
- `device_id` (required): Device identifier
- `limit` (optional): Number of items (default: 30, max: 100)

**Headers (optional):**
```
Authorization: Bearer <user-jwt>
```

**Response:**
```json
{
  "success": true,
  "items": [
    {
      "id": "uuid",
      "store_id": "amazon",
      "product_url": "https://...",
      "title": "Product Name",
      "image_url": "https://...",
      "view_count": 3,
      "last_viewed_at": "2026-01-17T08:00:00Z"
    }
  ],
  "count": 1
}
```

### Table: `recently_viewed_items`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | Primary key |
| user_id | uuid | Nullable, auth.users reference |
| device_id | text | Device identifier |
| store_id | text | Store identifier |
| product_url | text | Product URL |
| title | text | Product title (nullable) |
| image_url | text | Product image URL (nullable) |
| view_count | integer | Number of times viewed |
| last_viewed_at | timestamptz | Last view timestamp |
| created_at | timestamptz | Record creation time |
| updated_at | timestamptz | Last update time |

**Unique constraint:** `(COALESCE(user_id::text, ''), device_id, product_url)`

**Behavior:**
- Items are NEVER global - always scoped to user_id OR device_id
- If authenticated: returns items for that user_id OR device_id
- If guest: returns items for device_id only
- Ordered by `last_viewed_at DESC`

---

## E) Favorites Deprecation

**Status:** No favorites tables existed in the database. No action needed.

If favorites tables are added in the future, they can be safely locked down by:
1. Adding restrictive RLS policies
2. Removing public endpoint access
3. Eventually dropping the tables after confirming no usage

---

## Error Codes Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `EMAIL_NOT_VERIFIED` | 403 | User must verify email before checkout |
| `AUTH_REQUIRED` | 401 | Authentication required for merge |
| `INVALID_TOKEN` | 401 | Invalid or expired session |
| `INVALID_DEVICE_ID` | 400 | device_id is missing or empty |
| `INVALID_STORE_ID` | 400 | store_id is missing or empty |
| `INVALID_PRODUCT_URL` | 400 | product_url is missing or empty |
| `INVALID_CART` | 400 | cart must be an array |
| `METHOD_NOT_ALLOWED` | 405 | Wrong HTTP method used |
| `DB_ERROR` | 500 | Database operation failed |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Testing Checklist

### Email Verification
- [ ] Unverified user cannot insert into `orders` (RLS blocks)
- [ ] Unverified user cannot insert into `checkout_sessions` (RLS blocks)
- [ ] Unverified user cannot insert into `payment_attempts` (RLS blocks)
- [ ] Verified user can insert into `orders` and `checkout_sessions`
- [ ] `is_email_verified()` returns correct boolean

### Guest Cart Merge
- [ ] Guest can save cart snapshot
- [ ] Authenticated user can merge guest cart
- [ ] Merge is idempotent (repeat calls return same result)
- [ ] Items deduplicated by normalized URL
- [ ] Cart totals recalculated after merge

### Store Visit Tracking
- [ ] Guest can track visits (user_id = null)
- [ ] Authenticated user can track visits (user_id captured)
- [ ] Visit count increments on repeat visits
- [ ] Invalid store_id returns 400 error

### Recently Viewed
- [ ] Guest can upsert/list recently viewed
- [ ] Authenticated user can upsert/list recently viewed
- [ ] Items are never returned globally (always user/device scoped)
- [ ] View count increments on repeat views
- [ ] Title/image_url updated when provided

### Curl Examples

**Save Guest Cart Snapshot:**
```bash
curl -X POST https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/cart-guest-snapshot \
  -H "Content-Type: application/json" \
  -d '{"device_id":"device-123","cart":[{"productUrl":"https://amazon.com/dp/B123","title":"Test","unitPrice":29.99,"quantity":1}]}'
```

**Merge Guest Cart (authenticated):**
```bash
curl -X POST https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/merge-guest-cart \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <user-jwt>" \
  -d '{"guest_device_id":"device-123","guest_items":[{"productUrl":"https://amazon.com/dp/B123","title":"Test","unitPrice":29.99,"quantity":1}],"idempotency_key":"unique-key"}'
```

**Track Store Visit (guest):**
```bash
curl -X POST https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/track-store-visit \
  -H "Content-Type: application/json" \
  -d '{"store_id":"amazon","device_id":"device-123"}'
```

**Recently Viewed Upsert (authenticated):**
```bash
curl -X POST https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/recently-viewed-upsert \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <user-jwt>" \
  -d '{"device_id":"device-123","store_id":"amazon","product_url":"https://amazon.com/dp/B123","title":"Test Product"}'
```

**Recently Viewed List:**
```bash
curl "https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/recently-viewed-list?device_id=device-123&limit=10"
```

---

## Confirmation

✅ Stripe logic: **UNCHANGED**  
✅ pawaPay logic: **UNCHANGED**  
✅ Email verification: **ENFORCED at DB level** (orders, checkout_sessions, payment_attempts)  
✅ Guest cart merge: **Idempotent merge with deduplication**  
✅ Recently viewed: **Per-user/device, never global**  
✅ Store visits: **Per-user/device tracking**  
✅ Favorites: **No tables exist, nothing to deprecate**
