# Mobile App Integration Guide for AfriShop

Complete API reference for integrating the AfriShop native mobile app with the backend.

## ⚠️ CRITICAL: Authentication Configuration

### Environment Verification

**Before any auth work, verify your app uses the CORRECT Supabase project:**

```typescript
// Add this at app startup to verify configuration
console.log('[AUTH_ENV] supabaseUrl=' + SUPABASE_URL.replace('https://', '').split('.')[0]);
console.log('[AUTH_ENV] anonKeyPrefix=' + SUPABASE_ANON_KEY.substring(0, 20));

// Expected output:
// [AUTH_ENV] supabaseUrl=igmkhxffnyzoogcqvdab
// [AUTH_ENV] anonKeyPrefix=eyJhbGciOiJIUzI1NiIs
```

If the output doesn't match, your app is pointing to the wrong Supabase project!

### Debug Endpoint

Call `GET /functions/v1/auth-debug` to verify your app's configuration matches the backend:

```typescript
const response = await fetch('https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/auth-debug', {
  headers: { 'apikey': SUPABASE_ANON_KEY }
});
const config = await response.json();
console.log('[AUTH_DEBUG]', config.environment);
// Should show: matches_expected: true
```

---

## Authentication

All mobile API endpoints require authentication using Supabase Auth JWT tokens.

### 1. Configure Supabase Client

```typescript
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store'; // For Expo
// OR import AsyncStorage from '@react-native-async-storage/async-storage';

// ═══════════════════════════════════════════════════════════════════
// CRITICAL: Use these EXACT values - must match web app and backend
// ═══════════════════════════════════════════════════════════════════
const SUPABASE_URL = 'https://igmkhxffnyzoogcqvdab.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnbWtoeGZmbnl6b29nY3F2ZGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxMzM2NjYsImV4cCI6MjA3OTcwOTY2Nn0.xMa-K25tL63StMYRZDq7xovDPyrWlB_LA-KkGciqZaA';

// Custom storage adapter for React Native (required for session persistence)
const ExpoSecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: ExpoSecureStoreAdapter,  // Use secure storage for sessions
    autoRefreshToken: true,           // Automatically refresh tokens before expiry
    persistSession: true,             // Persist session to storage
    detectSessionInUrl: false,        // Don't process OAuth redirects (mobile apps)
  }
});
```

### 2. Load Session on App Startup

**CRITICAL**: Always check for existing session when app starts:

```typescript
async function initializeAuth() {
  // Log environment for debugging
  console.log('[AUTH_ENV] project=' + SUPABASE_URL.split('//')[1].split('.')[0]);
  
  const { data: { session }, error } = await supabase.auth.getSession();
  
  if (error) {
    console.error('[AUTH] session_load_error:', error.message);
    navigateToLogin();
    return;
  }
  
  if (!session) {
    console.log('[AUTH] no_active_session');
    navigateToLogin();
    return;
  }
  
  console.log('[AUTH] session_loaded userId=' + session.user.id);
  // User is authenticated, proceed to main app
}
```

### 3. Sign In (RECOMMENDED: Direct Supabase Auth)

**⚠️ IMPORTANT**: Use `supabase.auth.signInWithPassword` directly - NOT a custom edge function.
This ensures the same auth flow as the web app.

```typescript
async function signIn(email: string, password: string) {
  // ═══════════════════════════════════════════════════════════════
  // CRITICAL INPUT HANDLING:
  // - Email: trim() and toLowerCase() - email comparison is case-insensitive
  // - Password: NEVER modify - passwords are case-sensitive!
  // ═══════════════════════════════════════════════════════════════
  const normalizedEmail = email.trim().toLowerCase();
  const rawPassword = password; // Keep exactly as entered
  
  console.log('[AUTH] login_attempt email=' + normalizedEmail.substring(0, 3) + '***');
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password: rawPassword,
  });
  
  if (error) {
    console.error('[AUTH] login_failed code=' + error.status + ' message=' + error.message);
    
    // Return user-friendly error
    let userMessage = 'Email ou mot de passe incorrect.';
    if (error.message.includes('Email not confirmed')) {
      userMessage = 'Veuillez vérifier votre email avant de vous connecter.';
    } else if (error.message.includes('Too many requests')) {
      userMessage = 'Trop de tentatives. Réessayez plus tard.';
    }
    
    throw new Error(userMessage);
  }
  
  console.log('[AUTH] login_success userId=' + data.user.id + ' email=' + data.user.email);
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
const { activeItems, savedItems, summary } = await response.json();
```

#### Summary Fields - IMPORTANT CLARIFICATION

| Field | Description | Use For |
|-------|-------------|---------|
| `itemsTotalUsd` | Sum of BASE prices only (BEFORE margin) | Shipping calculation input |
| `markupFeeUsd` | Total margin/markup fee | **USE THIS DIRECTLY for display** |
| `shippingFeeUsd` | **PRE-CALCULATED** shipping fee | **USE THIS DIRECTLY** |
| `totalUsd` | Grand total (items + markup + shipping) | Final price display |

**⚠️ CRITICAL: Use Pre-Calculated Summary Values**

The backend returns `summary.markupFeeUsd` and `summary.shippingFeeUsd` as **pre-calculated values**. 
Display these directly - do NOT recalculate them in the mobile app.

**If using `mobile-public-config` for local calculations:**
- `markup.value` = **whole number** (e.g., 30.2 for 30.2%) → divide by 100 before use
- `shipping.percentValue` = **decimal** (e.g., 0.1 for 10%) → use directly

```
// Correct margin calculation if doing locally:
marginUsd = subtotalUsd * (config.markup.value / 100)  // 272.92 * (30.2 / 100) = 82.42

// Correct shipping calculation if doing locally:
shippingUsd = config.shipping.flatUsd + (subtotalUsd * config.shipping.percentValue)
```

**⚠️ COMMON BUG**: Do NOT use the displayed "Prix Total des Articles" (which includes margin) for shipping calculation. Use `itemsTotalUsd` (base prices only) or simply display `summary.shippingFeeUsd` directly.

#### Response Example
```json
{
  "ok": true,
  "activeItems": [{
    "id": "uuid",
    "productUrl": "https://...",
    "productTitle": "Product Name",
    "productImageUrl": "https://...",
    "quantity": 1,
    "basePriceUsd": 9.95,
    "itemMarginUsd": 2.99,
    "itemSubtotalUsd": 12.94,
    "itemTotalUsd": 12.94
  }],
  "savedItems": [],
  "summary": {
    "cartId": "uuid",
    "itemCount": 1,
    "itemsTotalUsd": 9.95,
    "markupFeeUsd": 2.99,
    "shippingFeeUsd": 41.00,
    "totalUsd": 53.94,
    "totalCdf": 118668,
    "exchangeRate": 2200,
    "shipping_debug": {
      "raw_shippingPercent": 10,
      "normalized_shippingPercent": 0.1,
      "shippingBaseFeeUsd": 40,
      "regularItemsBaseTotal": 9.95,
      "regularShippingTotal": 41.00,
      "formula_explanation": "$40.00 + ($9.95 × 10%) = $41.00",
      "important_note": "Use summary.shippingFeeUsd directly"
    }
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

---

## Native Product Catalog API

The native catalog system provides product browsing without WebView. It's controlled by feature flags in `/mobile-public-config`.

### Environment Detection

The catalog uses environment-based routing. Include the header to access staging features:

```typescript
// For staging environment (native catalog enabled)
headers: {
  'X-Afrishop-Environment': 'staging'
}

// For production (default - webview mode)
// No header needed, defaults to production
```

### Check Catalog Mode

The `/mobile-public-config` response includes catalog configuration:

```typescript
interface PublicConfigResponse {
  // ... existing fields ...
  
  catalog: {
    enabled: boolean;              // Is native catalog enabled?
    mode: "webview" | "native" | "hybrid";
    apiBaseUrl: string;            // Base URL for catalog endpoints
    providers: string[];           // Enabled provider names
    refreshIntervalMs: number;     // Refresh interval (5 min default)
  };
  
  env: {
    name: "production" | "staging";
    minSupportedAppVersion: string;
    ota: {
      enabled: boolean;
      channel: string;
    };
  };
}
```

### Catalog Endpoints

#### GET /catalog-home
Returns featured categories and trending products for the home screen.

**Auth**: Public (apikey only)

**Response**:
```json
{
  "success": true,
  "featured": [
    { "type": "category", "id": "uuid", "name": "Electronics", "imageUrl": "..." }
  ],
  "trending": [
    { "id": "uuid", "title": "iPhone 15", "priceUsd": 999, "imageUrl": "..." }
  ],
  "categories": [
    { "id": "uuid", "name": "Electronics", "icon": "📱" }
  ]
}
```

#### GET /catalog-search
Search products across all enabled providers.

**Auth**: Public (apikey only)

**Query Parameters**:
- `q` (required): Search query
- `page`: Page number (default: 1)
- `minPrice`: Minimum price filter
- `maxPrice`: Maximum price filter
- `category`: Category filter

**Response**:
```json
{
  "success": true,
  "query": "iphone",
  "page": 1,
  "pageSize": 20,
  "totalResults": 150,
  "hasMore": true,
  "products": [
    {
      "id": "uuid",
      "providerProductId": "B0...",
      "providerName": "amazon",
      "title": "Apple iPhone 15 Pro",
      "priceUsd": 999.00,
      "imageUrl": "https://...",
      "productUrl": "https://amazon.com/...",
      "inStock": true,
      "rating": 4.5
    }
  ],
  "providers": ["amazon", "walmart"],
  "cacheHit": true,
  "durationMs": 120
}
```

#### GET /catalog-product
Get detailed product information.

**Auth**: Public (apikey only)

**Query Parameters**:
- `id` (required): Product UUID from cache
- `includeEstimates`: Set to "true" to include price estimates

**Response**:
```json
{
  "success": true,
  "product": {
    "id": "uuid",
    "title": "Apple iPhone 15 Pro",
    "brand": "Apple",
    "description": "...",
    "priceUsd": 999.00,
    "imageUrl": "https://...",
    "productUrl": "https://amazon.com/...",
    "inStock": true,
    "rating": 4.5,
    "reviewCount": 1250,
    "categoryPath": ["Electronics", "Phones", "Smartphones"]
  },
  "estimates": {
    "priceUsd": 999.00,
    "markupEstimateUsd": 299.70,
    "shippingEstimateUsd": 139.90,
    "totalEstimateUsd": 1438.60
  }
}
```

#### GET /catalog-category
Get products within a specific category.

**Auth**: Public (apikey only)

**Query Parameters**:
- `id` (required): Category UUID
- `page`: Page number (default: 1)

**Response**:
```json
{
  "success": true,
  "category": {
    "id": "uuid",
    "name": "Electronics",
    "iconUrl": "..."
  },
  "page": 1,
  "pageSize": 20,
  "products": [...],
  "hasMore": true
}
```

### Pricing in Catalog

**Important**: Catalog endpoints return raw `priceUsd` from the provider. The mobile app should calculate the final price using the `markup` and `shipping` values from `/mobile-public-config`:

```typescript
// Get config
const config = await fetchPublicConfig();

// Calculate total for a product
const basePrice = product.priceUsd;
const markup = basePrice * (config.markup.value / 100);
const shipping = config.shipping.flatUsd + (basePrice * config.shipping.percentValue);
const total = basePrice + markup + shipping;
```

### Adding Catalog Products to Cart

When a user adds a catalog product to their cart, use the existing cart endpoints with the product URL:

```typescript
// Add catalog product to cart
await fetch('/mobile-add-cart-item', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({
    productUrl: product.productUrl,  // From catalog product
    productPrice: product.priceUsd,  // Raw price from catalog
    quantity: 1,
    productTitle: product.title,
    productImageUrl: product.imageUrl
  })
});
```
