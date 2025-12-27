# Backend Robustness Checklist - Checkout Edge Functions

## Overview

This document verifies that checkout edge functions are production-ready, specifically ensuring that **large payments / bank transfer paths never return non-2xx responses** for expected cases.

## ✅ Acceptance Criteria

| Criteria | Status |
|----------|--------|
| Expected cases return HTTP 200 with structured JSON | ✅ DONE |
| `mode="manual"` returned when amount exceeds limits | ✅ DONE |
| `mode="manual"` returned when provider fails | ✅ DONE |
| `bank_transfer` details included in manual mode | ✅ DONE |
| Idempotency for retry safety | ✅ DONE |
| Soft rate limiting (returns manual, not 429) | ✅ DONE |
| Structured logging with request_id | ✅ DONE |
| No PII in logs | ✅ DONE |

## Response Schema

All checkout endpoints now return this schema (HTTP 200):

```json
{
  "ok": true|false,
  "mode": "redirect" | "manual",
  "currency": "USD" | "CDF",
  "amount": 1234.56,
  "order_id": "uuid",
  "reference": "AFRI-XXXXXXXX-XXXX",
  "redirect_url": "https://...",  // when mode="redirect"
  "bank_transfer": {              // when mode="manual"
    "beneficiary_name": "...",
    "bank_name": "...",
    "iban_or_rib": "...",
    "swift_or_bic": "..."
  },
  "error": {                      // when ok=false
    "code": "AMOUNT_EXCEEDS_LIMIT",
    "message": "..."
  }
}
```

## Test Cases

### 1. Small Amount (< $5,000 USD) → mode="redirect"

```bash
curl -X POST https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/create-payment-link \
  -H "Content-Type: application/json" \
  -H "apikey: YOUR_ANON_KEY" \
  -d '{"order_id": "YOUR_ORDER_ID"}'
```

**Expected:** `ok: true, mode: "redirect", redirect_url: "https://..."`

### 2. Large Amount (> $5,000 USD and > 30M CDF) → mode="manual"

```bash
# For orders with total > limits
curl -X POST https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1/create-payment-link \
  -H "Content-Type: application/json" \
  -H "apikey: YOUR_ANON_KEY" \
  -d '{"order_id": "LARGE_ORDER_ID"}'
```

**Expected:** `ok: true, mode: "manual", bank_transfer: {...}`

### 3. payment_method="bank_transfer" → mode="manual"

Frontend can explicitly request bank transfer mode.

### 4. Provider Failure → mode="manual" with error

When MaishaPay is unavailable, returns:
```json
{
  "ok": false,
  "mode": "manual",
  "bank_transfer": {...},
  "error": {"code": "PROVIDER_LINK_FAILED", "message": "..."}
}
```

### 5. Missing Bank Config → mode="manual" with error

```json
{
  "ok": false,
  "mode": "manual",
  "bank_transfer": {"beneficiary_name": "Contact Support", ...},
  "error": {"code": "BANK_CONFIG_MISSING", "message": "..."}
}
```

### 6. Rapid Retries → Idempotent + Soft Rate Limit

Same request within 10 minutes returns existing session.
After 8+ requests in 30 seconds: returns `mode="manual"` with `error.code="RATE_LIMIT_SOFT"`.

## Files Changed

| File | Purpose |
|------|---------|
| `_shared/checkoutResponse.ts` | Standardized response builders, bank config, rate limiting |
| `create-payment-link/index.ts` | Always returns 200, manual fallback for large amounts |
| `initiate-link-payment/index.ts` | Always returns 200, manual fallback when limits exceeded |

## Logging

All logs use prefix `[CHECKOUT_EDGE]` with structured data:
- `request_id` - unique per request
- `order_id` - order being processed
- `user_id` - hashed/partial (no PII)
- `amount`, `currency`, `mode`

## Go-Live Monitoring

### Endpoints to Alert On
- `create-payment-link` - error rate > 1%
- `initiate-link-payment` - error rate > 1%
- `mobile-checkout` - p95 latency > 3s

### Key Metrics
- `mode=manual` rate (expected: ~5-10% for large orders)
- `PROVIDER_LINK_FAILED` count
- `RATE_LIMIT_SOFT` count

### Alert Thresholds
- Error rate (5xx) > 0.5% → Critical
- p95 latency > 2.5s → Warning
- `BANK_CONFIG_MISSING` > 0 → Action Required
