-- Backfill Stripe failures from stored webhook events
UPDATE public.payments p
SET
  failure_code = COALESCE(p.failure_code, ev->'data'->'object'->'last_payment_error'->>'decline_code', ev->'data'->'object'->'last_payment_error'->>'code'),
  failure_reason = COALESCE(p.failure_reason, ev->'data'->'object'->'last_payment_error'->>'message')
FROM (
  SELECT id, jsonb_array_elements(raw_events) AS ev
  FROM public.payments
  WHERE provider_key = 'stripe'
    AND status = 'failed'
    AND failure_reason IS NULL
    AND raw_events IS NOT NULL
) src
WHERE p.id = src.id
  AND src.ev->'data'->'object'->'last_payment_error' IS NOT NULL;

-- Backfill PawaPay callback failures
UPDATE public.payments p
SET
  failure_code = COALESCE(p.failure_code, ev->'failureReason'->>'failureCode'),
  failure_reason = COALESCE(p.failure_reason, ev->'failureReason'->>'failureMessage')
FROM (
  SELECT id, jsonb_array_elements(raw_events) AS ev
  FROM public.payments
  WHERE provider_key = 'pawapay'
    AND status = 'failed'
    AND failure_reason IS NULL
    AND raw_events IS NOT NULL
) src
WHERE p.id = src.id
  AND src.ev->'failureReason' IS NOT NULL;