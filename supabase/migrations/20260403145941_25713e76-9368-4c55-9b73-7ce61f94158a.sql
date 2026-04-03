
-- Add vehicle_pricing_tiers JSONB column to settings table
-- Stores tiered pricing percentages for USA → Dar es Salaam vehicle shipping
ALTER TABLE public.settings 
ADD COLUMN IF NOT EXISTS vehicle_pricing_tiers jsonb 
DEFAULT '{
  "tier_1_under_5000_percent": 70,
  "tier_2_5000_to_7999_percent": 58,
  "tier_3_8000_to_11999_percent": 48,
  "tier_4_12000_to_17999_percent": 40,
  "tier_5_18000_to_24999_percent": 34,
  "tier_6_25000_plus_percent": 28,
  "non_running_extra_percent": 7,
  "container_extra_percent": 8,
  "default_shipping_method": "roro",
  "default_vehicle_condition": "running"
}'::jsonb;

-- Backfill existing rows that have NULL
UPDATE public.settings 
SET vehicle_pricing_tiers = '{
  "tier_1_under_5000_percent": 70,
  "tier_2_5000_to_7999_percent": 58,
  "tier_3_8000_to_11999_percent": 48,
  "tier_4_12000_to_17999_percent": 40,
  "tier_5_18000_to_24999_percent": 34,
  "tier_6_25000_plus_percent": 28,
  "non_running_extra_percent": 7,
  "container_extra_percent": 8,
  "default_shipping_method": "roro",
  "default_vehicle_condition": "running"
}'::jsonb
WHERE vehicle_pricing_tiers IS NULL;
