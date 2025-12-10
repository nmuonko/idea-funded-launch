-- Extend price_cache with missing columns for full product info
ALTER TABLE price_cache
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS currency_symbol text DEFAULT '$',
  ADD COLUMN IF NOT EXISTS raw_currency_code text DEFAULT 'USD';

-- Add index for store-based lookups
CREATE INDEX IF NOT EXISTS idx_price_cache_store ON price_cache (store);

-- Update existing records to have default currency values
UPDATE price_cache 
SET currency_symbol = '$', raw_currency_code = 'USD' 
WHERE currency_symbol IS NULL;