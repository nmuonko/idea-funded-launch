# Backend Production Hardening Documentation

## Overview

This document describes the backend hardening changes for production readiness:
- Email verification enforcement for checkout
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

## B) Store Visit Tracking

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

## C) Recently Viewed Items

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

## D) Favorites Deprecation

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
| `INVALID_DEVICE_ID` | 400 | device_id is missing or empty |
| `INVALID_STORE_ID` | 400 | store_id is missing or empty |
| `INVALID_PRODUCT_URL` | 400 | product_url is missing or empty |
| `METHOD_NOT_ALLOWED` | 405 | Wrong HTTP method used |
| `DB_ERROR` | 500 | Database operation failed |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Testing Checklist

### Email Verification
- [ ] Unverified user cannot insert into `orders` (RLS blocks)
- [ ] Unverified user cannot insert into `checkout_sessions` (RLS blocks)
- [ ] Verified user can insert into `orders` and `checkout_sessions`
- [ ] `is_email_verified()` returns correct boolean

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
✅ Email verification: **ENFORCED at DB level**  
✅ Recently viewed: **Per-user/device, never global**  
✅ Store visits: **Per-user/device tracking**  
✅ Favorites: **No tables exist, nothing to deprecate**
