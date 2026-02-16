

# Auto-Reward Referrers with Mobile Data via Reloadly

## How It Works Today
The referral system already tracks signups and triggers payout claims when thresholds are reached (e.g., 10 verified signups = $5). Currently, this just creates a claim record and notifies the admin -- the actual payout is manual.

## What Changes
Instead of (or in addition to) a manual cash payout, the system will **automatically send mobile data or airtime** to the referrer's phone number via the Reloadly API when a threshold is reached.

```text
User signs up with ref link
        |
        v
  Email verified
        |
        v
  referral-on-verify runs
        |
        v
  Threshold reached? (e.g. 50 signups)
        |
        v
  Call Reloadly API --> send 100MB data to referrer's phone
        |
        v
  Log reward as "delivered" in database
```

## Implementation Steps

### Step 1 -- Store Reloadly API credentials
Securely store your Reloadly Client ID and Client Secret as backend secrets so edge functions can use them.

### Step 2 -- Extend payout rules table
Add columns to `referral_payout_rules` so admins can configure what type of reward to send:
- `reward_type`: `'cash'`, `'data'`, or `'airtime'` (default: `'cash'` for backward compatibility)
- `data_mb` (nullable): e.g. `100` for 100MB
- `airtime_amount` (nullable): amount in local currency for airtime top-ups
- `operator_country_code`: e.g. `'CD'` for DR Congo (default)

### Step 3 -- Create a `reloadly-topup` edge function
A new backend function that:
1. Authenticates with Reloadly (OAuth token using client credentials)
2. Auto-detects the operator for the referrer's phone number
3. Sends a data bundle or airtime top-up
4. Returns the transaction result

This function is called internally by `referral-on-verify` and can also be called manually from the admin dashboard for retries.

### Step 4 -- Update `referral-on-verify` to auto-deliver rewards
When a payout threshold is reached and the rule's `reward_type` is `'data'` or `'airtime'`:
1. Look up the referrer's phone number from the `referrers` table
2. Call the `reloadly-topup` function
3. If successful, mark the payout claim as `'delivered'` with the Reloadly transaction ID
4. If it fails, mark as `'delivery_failed'` so admins can retry

### Step 5 -- Update admin Referrals page
- Show reward type (cash / data / airtime) in the payout rules editor
- Add fields for `data_mb` and `airtime_amount` when editing rules
- Show delivery status on payout claims (delivered / failed / pending)
- Add a "Retry" button for failed deliveries

### Step 6 -- Add a `referral_topup_log` table
Track all Reloadly API calls for auditing:
- `claim_id`, `referrer_id`, `phone`, `operator`, `type` (data/airtime), `amount`, `reloadly_tx_id`, `status`, `error_message`, `created_at`

## Technical Details

### Reloadly API Flow
```text
1. POST https://auth.reloadly.com/oauth/token
   -> Get access_token (cache for ~5 min)

2. GET https://topups.reloadly.com/operators/auto-detect/phone/{phone}/countries/{countryCode}
   -> Get operator ID + available plans

3. POST https://topups.reloadly.com/topups
   {
     operatorId, amount, recipientPhone, countryCode,
     useLocalAmount: true
   }
   -> Transaction result
```

### Files to Create/Modify
- **New**: `supabase/functions/reloadly-topup/index.ts` -- Reloadly API wrapper
- **Edit**: `supabase/functions/referral-on-verify/index.ts` -- Add auto-delivery logic after claim creation
- **Edit**: `src/pages/admin/Referrals.tsx` -- Add reward type fields to rules editor + delivery status
- **New migration**: Add columns to `referral_payout_rules`, create `referral_topup_log` table

### Secrets Needed
- `RELOADLY_CLIENT_ID` -- Your Reloadly app Client ID
- `RELOADLY_CLIENT_SECRET` -- Your Reloadly app Client Secret
- `RELOADLY_SANDBOX` -- Set to `"true"` for testing, `"false"` for production

