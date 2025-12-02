# Mobile App Integration Guide for AfriShop

Complete API reference for integrating the AfriShop native mobile app with the backend.

## Authentication

All mobile API endpoints require authentication using Supabase Auth JWT tokens.

### 1. Configure Supabase Client

```typescript
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://igmkhxffnyzoogcqvdab.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,    // Automatically refresh tokens before expiry
    persistSession: true,      // Persist session to storage
    detectSessionInUrl: false, // Don't process OAuth redirects (mobile apps)
  }
});
```

### 2. Load Session on App Startup

**CRITICAL**: Always check for existing session when app starts:

```typescript
async function initializeAuth() {
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (error) {
    console.error('Session load error:', error);
    navigateToLogin();
    return;
  }
  
  if (!session) {
    console.log('No active session');
    navigateToLogin();
    return;
  }
  
  console.log('Session loaded, expires:', new Date(session.expires_at * 1000));
  // User is authenticated, proceed to main app
}
```

### 3. Sign In and Get Token

```typescript
async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  
  if (error) {
    console.error('Sign in error:', error.message);
    return null;
  }
  
  // Session automatically persisted
  console.log('Signed in:', data.user?.email);
  return data.session;
}
```

### 4. Get Fresh Token for API Calls

**ALWAYS** get a fresh token before making API requests:

```typescript
async function getAccessToken(): Promise<string | null> {
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (error || !session) {
    console.log('No valid session');
    return null;
  }
  
  // Check if token is expiring soon (within 60 seconds)
  const expiresAt = session.expires_at;
  const now = Math.floor(Date.now() / 1000);
  
  if (expiresAt && expiresAt - now < 60) {
    console.log('Token expiring, refreshing...');
    const { data: { session: refreshed } } = await supabase.auth.refreshSession();
    return refreshed?.access_token ?? null;
  }
  
  return session.access_token;
}
```

### 5. Making Authenticated API Requests

```typescript
async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const token = await getAccessToken();
  
  if (!token) {
    console.log('No token, redirecting to login');
    navigateToLogin();
    return null;
  }
  
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${endpoint}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      ...options.headers,
    }
  });
  
  // Handle 401 - try refresh and retry once
  if (response.status === 401) {
    console.log('Got 401, attempting token refresh...');
    
    const { data: { session } } = await supabase.auth.refreshSession();
    
    if (!session) {
      console.log('Refresh failed, signing out');
      await supabase.auth.signOut();
      navigateToLogin();
      return null;
    }
    
    // Retry with new token
    const retryResponse = await fetch(`${SUPABASE_URL}/functions/v1/${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        ...options.headers,
      }
    });
    
    if (retryResponse.status === 401) {
      // Still failing, force sign out
      await supabase.auth.signOut();
      navigateToLogin();
      return null;
    }
    
    return retryResponse.json();
  }
  
  // Check for JWT errors in response body
  const data = await response.json();
  
  if (data.error && typeof data.error === 'string' && 
      data.error.toLowerCase().includes('jwt')) {
    console.log('JWT error in response:', data.error);
    await supabase.auth.signOut();
    navigateToLogin();
    return null;
  }
  
  return data;
}
```

### 6. Verify User with /auth-me

```typescript
async function verifyUser() {
  const data = await apiRequest('auth-me');
  
  if (!data || data.error) {
    console.error('User verification failed');
    return null;
  }
  
  return data.user;
}
```

### 7. Sign Out

```typescript
async function signOut() {
  await supabase.auth.signOut();
  // Clear any local storage/cache
  navigateToLogin();
}
```

### Error Handling Summary

| Error | Action |
|-------|--------|
| No session on startup | Navigate to Login |
| 401 response | Refresh token, retry once |
| 401 after refresh | Sign out, navigate to Login |
| "Invalid JWT" error | Sign out, navigate to Login |
| Token expiring soon | Auto-refresh before request |

## Cart Management APIs

### 1. Get Cart
**Endpoint**: `GET /mobile-get-cart`

Returns the user's current cart (DRAFT order) with all items and pricing.

```typescript
const { items, summary } = await response.json();

// Response:
{
  items: [{
    id: "uuid",
    productUrl: "https://...",
    productTitle: "Product Name",
    productImageUrl: "https://...",
    quantity: 1,
    basePriceUsd: 100.00,
    markupFeeUsd: 15.00,
    shippingFeeUsd: 10.00,
    lineTotalUsd: 125.00,
    lineTotalCdf: 350000
  }],
  summary: {
    itemCount: 3,
    itemsTotalUsd: 300.00,
    markupFeeUsd: 45.00,
    shippingFeeUsd: 30.00,
    totalUsd: 375.00,
    totalCdf: 1050000,
    exchangeRate: 2800
  }
}
```

### 2. Add to Cart (with Intelligent Merge)
**Endpoint**: `POST /mobile-add-cart-item`

Adds a product to the cart. If same `productUrl` exists, quantities merge automatically.

**Request:**
```json
{
  "productUrl": "https://www.amazon.com/product-link",
  "productPrice": 99.99,
  "quantity": 1,
  "productTitle": "Optional Title",
  "productImageUrl": "Optional Image URL"
}
```

**Response:**
```json
{
  "success": true,
  "merged": false,
  "item": {
    "id": "uuid",
    "productUrl": "https://...",
    "quantity": 1,
    "basePriceUsd": 99.99,
    "markupFeeUsd": 15.00,
    "shippingFeeUsd": 10.99,
    "lineTotalUsd": 125.98,
    "lineTotalCdf": 352744
  }
}
```

### 3. Update Cart Item Quantity
**Endpoint**: `PATCH /mobile-update-cart-item/:itemId`

```json
{ "quantity": 2 }
```

### 4. Delete Cart Item
**Endpoint**: `DELETE /mobile-delete-cart-item/:itemId`

## Order Creation API

### Create Order from Cart
**Endpoint**: `POST /mobile-create-order-from-cart`

Converts cart (DRAFT) to order (PENDING_PAYMENT) with calculated totals.

**Success Response (200):**
```json
{
  "success": true,
  "orderId": "uuid",
  "order": {
    "id": "uuid",
    "status": "PENDING_PAYMENT",
    "itemCount": 3,
    "itemsTotalUsd": 1985.00,
    "markupTotalUsd": 297.75,
    "shippingTotalUsd": 31.99,
    "grandTotalUsd": 2314.74,
    "grandTotalCdf": 6481258,
    "exchangeRate": 2800
  }
}
```

**Error Responses:**

| Error Code | Status | Mobile Action |
|------------|--------|---------------|
| UNAUTHORIZED | 401 | Redirect to login |
| EMPTY_CART | 400 | Show message, redirect to shopping |
| DB_FETCH_ERROR | 500 | Show retry button |
| SETTINGS_ERROR | 500 | Contact support message |
| DB_ORDER_UPDATE_FAILED | 500 | Show retry button |

### Pricing Calculation

```
For each item:
  base_price_usd      = product price
  markup_fee_usd      = base_price * markup_percent / 100
  shipping_fee_usd    = flat_fee + (base_price * shipping_percent / 100)
  line_total_usd      = base_price + markup_fee + shipping_fee
  line_total_cdf      = line_total_usd * exchange_rate

Order totals (sum of items * quantity):
  items_total_usd     = Σ(base_price_usd * quantity)
  markup_total_usd    = Σ(markup_fee_usd * quantity)
  shipping_total_usd  = Σ(shipping_fee_usd * quantity)
  grand_total_usd     = items_total + markup_total + shipping_total
  grand_total_cdf     = grand_total_usd * exchange_rate
```

## Order Management APIs

### Get User Orders
**Endpoint**: `GET /mobile-get-orders`

### Get Order Details
**Endpoint**: `GET /mobile-get-order-by-id/:orderId`

### Check Order Status
**Endpoint**: `GET /mobile-order-status/:orderId`

```json
{
  "orderId": "uuid",
  "status": "paid",
  "grandTotalUsd": 125.50,
  "grandTotalCdf": 351400,
  "paymentStatus": "paid",
  "paidAt": "2025-11-30T10:30:00Z"
}
```

## Payment Integration

### Initiate MaishaPay Payment
**Endpoint**: `POST /mobile-initiate-maisha-payment/:orderId`

```json
// Response
{
  "orderId": "uuid",
  "payment": {
    "checkoutUrl": "https://checkout.maishapay.com/...",
    "maishaReference": "AFRISHOP-...",
    "amount": 351400,
    "currency": "CDF"
  }
}
```

Open `checkoutUrl` in WebView for user to complete payment.

### Retry Failed Payment
**Endpoint**: `POST /mobile-retry-payment/:orderId`

## Push Notifications

### Register Device Token
**Endpoint**: `POST /register-device-token`

```json
{
  "deviceToken": "fcm-or-apns-token",
  "platform": "ios"
}
```

**When to call**:
- After user logs in
- When app receives new device token
- On app launch (updates last_used_at)

## Complete Checkout Flow

```javascript
// 1. Create order from cart
const order = await createOrderFromCart(userToken);
if (!order) return;

// 2. Initiate payment
const payment = await initiatePayment(order.id);
if (!payment) return;

// 3. Open checkout URL
openWebView(payment.checkoutUrl);

// 4. Poll for status
const pollStatus = setInterval(async () => {
  const status = await checkOrderStatus(order.id);
  if (status.status === 'paid') {
    clearInterval(pollStatus);
    showSuccessScreen();
    closeWebView();
  } else if (status.paymentStatus === 'failed') {
    clearInterval(pollStatus);
    showRetryOption();
  }
}, 3000);
```

## Error Handling

All endpoints return errors as:
```json
{ "error": "ERROR_CODE", "message": "Human readable message" }
```

**Common HTTP Status Codes:**
- `200` - Success
- `400` - Bad request (missing/invalid parameters)
- `401` - Unauthorized (invalid or missing auth token)
- `403` - Forbidden (user doesn't own resource)
- `404` - Not found
- `500` - Server error

## Testing with cURL

```bash
# Get Cart
curl -X GET \
  https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/mobile-get-cart \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"

# Add to Cart
curl -X POST \
  https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/mobile-add-cart-item \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"productUrl": "https://www.amazon.com/product", "productPrice": 99.99, "quantity": 1}'
```

## Best Practices

1. **Cache Cart Data**: Cache locally, refresh when needed
2. **Optimistic Updates**: Update UI immediately, sync with backend
3. **Error Recovery**: Handle network errors with retry logic
4. **Token Refresh**: Implement automatic token refresh before expiry
5. **Loading States**: Show loading indicators during API calls
6. **Offline Mode**: Queue actions when offline, sync when online
