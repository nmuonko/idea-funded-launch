
-- Guardrail 5: Missing indexes for hot-path performance
CREATE INDEX IF NOT EXISTS idx_catalog_items_first_seen_at_desc ON public.catalog_items (first_seen_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_catalog_items_last_seen_at_desc ON public.catalog_items (last_seen_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_catalog_items_popularity_score_desc ON public.catalog_items (popularity_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_catalog_items_unified_category ON public.catalog_items (unified_category);

-- Guardrail 7: Exhaustion should be temporary with cooldown
ALTER TABLE public.catalog_builder_state ADD COLUMN IF NOT EXISTS cooldown_until timestamptz;

-- Ensure unique constraint exists for provider+provider_product_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_items_provider_product_id ON public.catalog_items (provider, provider_product_id);
