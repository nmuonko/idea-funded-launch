-- Add sort rotation and smarter exhaustion tracking to catalog_builder_state
ALTER TABLE public.catalog_builder_state 
  ADD COLUMN IF NOT EXISTS sort_mode text NOT NULL DEFAULT 'newlyListed',
  ADD COLUMN IF NOT EXISTS consecutive_zero_new_pages integer NOT NULL DEFAULT 0;

-- Add comment for clarity
COMMENT ON COLUMN public.catalog_builder_state.sort_mode IS 'Current eBay sort mode: newlyListed, endingSoonest, price. Rotated each run.';
COMMENT ON COLUMN public.catalog_builder_state.consecutive_zero_new_pages IS 'Number of consecutive pages with 0 new unique items. Used for smarter exhaustion.';