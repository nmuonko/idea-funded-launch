# App Bootstrap API Documentation

## Overview

The `app_bootstrap` endpoint provides a **stable, crash-proof configuration payload** for mobile app startup. It is designed to **never throw** and **always return `success: true`** with safe defaults even if the database is unavailable or misconfigured.

## Endpoint

```
GET /functions/v1/app-bootstrap
```

**Authentication**: None required (public endpoint)  
**Cache**: `no-store` (always fresh data)

## Response Schema

```json
{
  "success": true,
  "timestamp": "2026-01-17T10:30:00.000Z",
  "env": {
    "region": "us-east-1",
    "app_version_min": "1.0.0"
  },
  "payments": {
    "providers": [
      {
        "id": "pawapay",
        "enabled": true,
        "configured": true,
        "limits": { "min": 0, "max": 5000, "currency": "USD" }
      },
      {
        "id": "stripe",
        "enabled": true,
        "configured": true,
        "limits": { "min": 5000, "max": 100000, "currency": "USD" }
      },
      {
        "id": "bank_transfer",
        "enabled": true,
        "configured": true,
        "limits": { "min": 0, "max": 1000000, "currency": "USD" },
        "instructions": {
          "beneficiary_name": "Nathan Kadimisha",
          "bank_name": "Equity BCDC",
          "account_number_or_iban": "0292838930302027",
          "swift_bic": "BOFTSB12",
          "support_email": "nkadimisha@afrishop-usa.com",
          "support_whatsapp": "+13092068948",
          "instructions_en": "Put the reference in the transfer description.",
          "instructions_fr": "Mettez la référence dans le libellé du virement."
        }
      }
    ]
  }
}
```

## Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Always `true` - endpoint never fails |
| `timestamp` | string | ISO 8601 timestamp of response |
| `env.region` | string | Server region (e.g., "us-east-1") |
| `env.app_version_min` | string | Minimum required app version |
| `payments.providers` | array | Payment provider configurations |

### Provider Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Provider identifier: `pawapay`, `stripe`, `bank_transfer` |
| `enabled` | boolean | Whether provider is turned on by admin |
| `configured` | boolean | Whether provider has valid secrets/settings |
| `limits.min` | number | Minimum transaction amount (USD) |
| `limits.max` | number | Maximum transaction amount (USD) |
| `limits.currency` | string | Currency for limits (always "USD") |
| `instructions` | object | Bank transfer details (only for `bank_transfer`) |

### Understanding `enabled` vs `configured`

| State | Meaning | Mobile App Action |
|-------|---------|-------------------|
| `enabled: true, configured: true` | Ready to use | Show payment option |
| `enabled: true, configured: false` | Admin enabled but secrets missing | Hide option, log warning |
| `enabled: false, configured: true` | Temporarily disabled by admin | Hide option |
| `enabled: false, configured: false` | Not set up | Hide option |

## Example Responses

### Fully Configured (Production)

```bash
curl https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/app-bootstrap
```

```json
{
  "success": true,
  "timestamp": "2026-01-17T10:30:00.000Z",
  "env": { "region": "us-east-1", "app_version_min": "1.0.0" },
  "payments": {
    "providers": [
      { "id": "pawapay", "enabled": true, "configured": true, "limits": { "min": 0, "max": 3000, "currency": "USD" } },
      { "id": "stripe", "enabled": true, "configured": true, "limits": { "min": 3000, "max": 100000, "currency": "USD" } },
      { "id": "bank_transfer", "enabled": true, "configured": true, "limits": { "min": 0, "max": 1000000, "currency": "USD" }, "instructions": { "beneficiary_name": "Nathan Kadimisha", "bank_name": "Equity BCDC", "account_number_or_iban": "0292838930302027", "swift_bic": "BOFTSB12", "support_email": "nkadimisha@afrishop-usa.com", "support_whatsapp": "+13092068948", "instructions_en": "Put the reference in the transfer description.", "instructions_fr": "Mettez la référence dans le libellé du virement." } }
    ]
  }
}
```

### Not Configured (Fresh Install)

```json
{
  "success": true,
  "timestamp": "2026-01-17T10:30:00.000Z",
  "env": { "region": "unknown", "app_version_min": "1.0.0" },
  "payments": {
    "providers": [
      { "id": "pawapay", "enabled": false, "configured": false, "limits": { "min": 0, "max": 5000, "currency": "USD" } },
      { "id": "stripe", "enabled": false, "configured": false, "limits": { "min": 5000, "max": 100000, "currency": "USD" } },
      { "id": "bank_transfer", "enabled": false, "configured": false, "limits": { "min": 0, "max": 1000000, "currency": "USD" }, "instructions": { "beneficiary_name": "", "bank_name": "", "account_number_or_iban": "", "swift_bic": "", "support_email": "", "support_whatsapp": "", "instructions_en": "", "instructions_fr": "" } }
    ]
  }
}
```

## Mobile App Integration

```typescript
// On app startup
async function bootstrap() {
  try {
    const response = await fetch('https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/app-bootstrap');
    const config = await response.json();
    
    // Always succeeds - filter enabled providers
    const enabledProviders = config.payments.providers.filter(
      p => p.enabled && p.configured
    );
    
    // Store in app state
    setPaymentProviders(enabledProviders);
    
    // Log any misconfigured providers for debugging
    const misconfigured = config.payments.providers.filter(
      p => p.enabled && !p.configured
    );
    if (misconfigured.length > 0) {
      console.warn('Misconfigured providers:', misconfigured.map(p => p.id));
    }
  } catch (error) {
    // Network error - use offline defaults
    console.error('Bootstrap failed, using defaults:', error);
    setPaymentProviders([]);
  }
}
```

## Admin Changes

When an admin:
- **Disables a provider**: `enabled` becomes `false` immediately
- **Updates bank transfer details**: `instructions` object reflects changes
- **Enables Stripe**: Both `enabled` and `configured` become `true` (if secrets exist)

Changes are reflected in the next `app-bootstrap` call (no caching).

## Database Schema

### `payment_providers` table
- `provider_key`: 'pawapay' | 'stripe' | 'bank_transfer'
- `is_enabled`: boolean (NOT NULL, default: false)
- `is_default`: boolean (NOT NULL, default: false)
- `priority`: integer (NOT NULL, default: 100)

### `payment_settings` table (singleton)
- `pawapay_enabled`: boolean (default: true)
- `stripe_enabled`: boolean (default: false)
- `bank_transfer_enabled`: boolean (default: true)
- `mobile_money_max_usd`: number (default: 5000)

### `bank_transfer_settings` table (singleton)
- `is_active`: boolean (default: true)
- `beneficiary_name`: text (default: '')
- `bank_name`: text (default: '')
- `account_number_or_iban`: text (default: '')
- `swift_bic`: text
- `support_email`: text
- `support_whatsapp`: text
- `instructions_en`: text
- `instructions_fr`: text

## Testing Checklist

- [ ] Call endpoint with no auth - should return 200
- [ ] Disable pawaPay in admin - `enabled: false` in response
- [ ] Remove PAWAPAY_API_TOKEN secret - `configured: false` in response
- [ ] Update bank transfer details - changes reflected immediately
- [ ] Kill database connection - still returns 200 with safe defaults
- [ ] Invalid JSON in config_public - doesn't crash, uses defaults
