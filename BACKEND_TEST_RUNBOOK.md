# Backend Test Runbook

**Project:** AfriShop  
**Purpose:** Step-by-step commands to run all backend tests

---

## Prerequisites

```bash
# Install k6 (load testing)
brew install k6  # macOS
# OR: https://k6.io/docs/getting-started/installation/

# Install Deno (integration tests)
curl -fsSL https://deno.land/install.sh | sh

# Set environment variables
export SUPABASE_URL="https://igmkhxffnyzoogcqvdab.supabase.co"
export SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlnbWtoeGZmbnl6b29nY3F2ZGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxMzM2NjYsImV4cCI6MjA3OTcwOTY2Nn0.xMa-K25tL63StMYRZDq7xovDPyrWlB_LA-KkGciqZaA"

# Get a test user token (login via app and extract from network tab)
export TEST_USER_TOKEN="your-jwt-token-here"
```

---

## 1. Run RLS Verification Tests

```bash
# Basic test (no auth required)
deno run --allow-env --allow-net tests/integration/rls-verification.test.ts

# With test users (full isolation testing)
export TEST_USER_A_TOKEN="user-a-token"
export TEST_USER_B_TOKEN="user-b-token"
export TEST_USER_A_ID="user-a-uuid"
export TEST_USER_B_ID="user-b-uuid"
deno run --allow-env --allow-net tests/integration/rls-verification.test.ts
```

---

## 2. Run API Validation Tests

```bash
# Basic validation (unauthorized tests only)
deno run --allow-env --allow-net tests/integration/api-validation.test.ts

# Full validation with auth
export TEST_USER_TOKEN="your-jwt-token"
deno run --allow-env --allow-net tests/integration/api-validation.test.ts
```

---

## 3. Run Load Tests

### Create results directory
```bash
mkdir -p tests/load/results
```

### Cart Read Heavy (60% of traffic)
```bash
k6 run \
  --env BASE_URL=$SUPABASE_URL/functions/v1 \
  --env TEST_TOKEN=$TEST_USER_TOKEN \
  --env ANON_KEY=$SUPABASE_ANON_KEY \
  --env VUS=100 \
  --env DURATION=10m \
  tests/load/k6/cart_read_heavy.js
```

### Cart Mutation Mix (25% of traffic)
```bash
k6 run \
  --env BASE_URL=$SUPABASE_URL/functions/v1 \
  --env TEST_TOKEN=$TEST_USER_TOKEN \
  --env ANON_KEY=$SUPABASE_ANON_KEY \
  --env VUS=50 \
  --env DURATION=10m \
  tests/load/k6/cart_mutation_mix.js
```

### Checkout Mix (10% of traffic)
```bash
k6 run \
  --env BASE_URL=$SUPABASE_URL/functions/v1 \
  --env TEST_TOKEN=$TEST_USER_TOKEN \
  --env ANON_KEY=$SUPABASE_ANON_KEY \
  --env VUS=25 \
  --env DURATION=10m \
  tests/load/k6/checkout_mix.js
```

### Full User Journey (complete simulation)
```bash
k6 run \
  --env BASE_URL=$SUPABASE_URL/functions/v1 \
  --env TEST_TOKEN=$TEST_USER_TOKEN \
  --env ANON_KEY=$SUPABASE_ANON_KEY \
  --env VUS=100 \
  --env DURATION=10m \
  tests/load/k6/full_user_journey.js
```

---

## 4. Run All Tests (Sequential)

```bash
#!/bin/bash
# run-all-tests.sh

echo "=== RLS Verification ==="
deno run --allow-env --allow-net tests/integration/rls-verification.test.ts

echo "=== API Validation ==="
deno run --allow-env --allow-net tests/integration/api-validation.test.ts

echo "=== Load Tests ==="
mkdir -p tests/load/results

k6 run --env VUS=50 --env DURATION=5m tests/load/k6/cart_read_heavy.js
k6 run --env VUS=25 --env DURATION=5m tests/load/k6/cart_mutation_mix.js
k6 run --env VUS=15 --env DURATION=5m tests/load/k6/checkout_mix.js

echo "=== Results ==="
cat tests/load/results/*.json
```

---

## 5. Quick Smoke Test

```bash
# 1-minute quick validation
k6 run \
  --env VUS=10 \
  --env DURATION=1m \
  tests/load/k6/cart_read_heavy.js
```

---

## 6. View Results

```bash
# JSON results
cat tests/load/results/cart_read_heavy.json
cat tests/load/results/full_user_journey.json

# Check thresholds passed
jq '.thresholds.passed' tests/load/results/*.json
```

---

## Scaling Tests

### 500 Concurrent Users (Baseline)
```bash
k6 run --env VUS=500 --env DURATION=10m tests/load/k6/full_user_journey.js
```

### 1,000 Concurrent Users (Target)
```bash
k6 run --env VUS=1000 --env DURATION=10m tests/load/k6/full_user_journey.js
```

### 2,500 Concurrent Users (Stretch)
```bash
k6 run --env VUS=2500 --env DURATION=5m tests/load/k6/full_user_journey.js
```

---

## Troubleshooting

### Token Expired
```bash
# Get new token from browser DevTools > Network > any auth request > Headers
```

### Rate Limited
```bash
# Wait 60 seconds between test runs
# Or reduce VUS
```

### Connection Errors
```bash
# Check Supabase project status
# Verify BASE_URL is correct
```
