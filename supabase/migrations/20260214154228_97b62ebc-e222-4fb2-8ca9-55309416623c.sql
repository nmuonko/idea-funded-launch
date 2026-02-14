
-- Create product_variants_cache table
CREATE TABLE public.product_variants_cache (
  source TEXT NOT NULL,        -- 'amazon' or 'ebay'
  product_id TEXT NOT NULL,    -- ASIN for amazon, itemId for ebay
  variants_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (source, product_id)
);

-- Index for TTL cleanup
CREATE INDEX idx_product_variants_cache_expires ON public.product_variants_cache (expires_at);

-- Enable RLS
ALTER TABLE public.product_variants_cache ENABLE ROW LEVEL SECURITY;

-- Allow anon/authenticated to read (service role writes via edge functions)
CREATE POLICY "Anyone can read variants cache"
  ON public.product_variants_cache
  FOR SELECT
  USING (true);

-- Update cleanup_all_expired_data to also clean variants cache
CREATE OR REPLACE FUNCTION public.cleanup_all_expired_data()
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_catalog_cache_deleted integer := 0;
  v_catalog_rate_limits_deleted integer := 0;
  v_rate_limits_deleted integer := 0;
  v_product_cache_deleted integer := 0;
  v_product_hot_cache_deleted integer := 0;
  v_provider_budget_deleted integer := 0;
  v_payment_attempts_expired integer := 0;
  v_home_seen_items_deleted integer := 0;
  v_guest_cart_snapshots_deleted integer := 0;
  v_catalog_facets_cache_deleted integer := 0;
  v_variants_cache_deleted integer := 0;
  v_start_time timestamptz := clock_timestamp();
BEGIN
  DELETE FROM public.catalog_cache WHERE expires_at < now() - interval '1 hour';
  GET DIAGNOSTICS v_catalog_cache_deleted = ROW_COUNT;
  
  DELETE FROM public.catalog_rate_limits WHERE window_start < now() - interval '2 hours';
  GET DIAGNOSTICS v_catalog_rate_limits_deleted = ROW_COUNT;
  
  DELETE FROM public.rate_limits WHERE expires_at < now();
  GET DIAGNOSTICS v_rate_limits_deleted = ROW_COUNT;
  
  DELETE FROM public.product_cache WHERE expires_at < now();
  GET DIAGNOSTICS v_product_cache_deleted = ROW_COUNT;
  
  DELETE FROM public.product_hot_cache WHERE expires_at < now();
  GET DIAGNOSTICS v_product_hot_cache_deleted = ROW_COUNT;
  
  DELETE FROM public.provider_budget WHERE window_start < now() - interval '48 hours';
  GET DIAGNOSTICS v_provider_budget_deleted = ROW_COUNT;
  
  UPDATE public.payment_attempts SET status = 'expired', updated_at = now()
  WHERE status = 'pending' AND expires_at < now();
  GET DIAGNOSTICS v_payment_attempts_expired = ROW_COUNT;
  
  DELETE FROM public.home_seen_items WHERE seen_at < now() - interval '7 days';
  GET DIAGNOSTICS v_home_seen_items_deleted = ROW_COUNT;
  
  DELETE FROM public.guest_cart_snapshots WHERE updated_at < now() - interval '30 days';
  GET DIAGNOSTICS v_guest_cart_snapshots_deleted = ROW_COUNT;
  
  DELETE FROM public.catalog_facets_cache WHERE expires_at < now();
  GET DIAGNOSTICS v_catalog_facets_cache_deleted = ROW_COUNT;

  DELETE FROM public.product_variants_cache WHERE expires_at < now();
  GET DIAGNOSTICS v_variants_cache_deleted = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'catalog_cache_deleted', v_catalog_cache_deleted,
    'catalog_rate_limits_deleted', v_catalog_rate_limits_deleted,
    'rate_limits_deleted', v_rate_limits_deleted,
    'product_cache_deleted', v_product_cache_deleted,
    'product_hot_cache_deleted', v_product_hot_cache_deleted,
    'provider_budget_deleted', v_provider_budget_deleted,
    'payment_attempts_expired', v_payment_attempts_expired,
    'home_seen_items_deleted', v_home_seen_items_deleted,
    'guest_cart_snapshots_deleted', v_guest_cart_snapshots_deleted,
    'catalog_facets_cache_deleted', v_catalog_facets_cache_deleted,
    'variants_cache_deleted', v_variants_cache_deleted,
    'duration_ms', EXTRACT(MILLISECOND FROM clock_timestamp() - v_start_time)::integer,
    'cleanup_at', now()
  );
END;
$function$;
