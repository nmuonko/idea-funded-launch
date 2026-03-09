
-- Add orphan PENDING_PAYMENT order cleanup to the cron function
-- Orphan orders = PENDING_PAYMENT with 0 items, older than 30 minutes
-- These are caused by edge function crashes between order INSERT and item COPY

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
  v_translation_cache_deleted integer := 0;
  v_stale_orders_cancelled integer := 0;
  v_empty_drafts_deleted integer := 0;
  v_orphan_pending_deleted integer := 0;
  v_reminders_triggered integer := 0;
  v_start_time timestamptz := clock_timestamp();
  v_base_url text;
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
  
  -- NEW: Delete orphan PENDING_PAYMENT orders with 0 items older than 30 minutes
  -- These are caused by edge function crashes between order creation and item copy
  DELETE FROM public.orders 
  WHERE status = 'PENDING_PAYMENT'
  AND created_at < now() - interval '30 minutes'
  AND created_at = updated_at  -- Never updated after creation = orphan
  AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = orders.id)
  AND NOT EXISTS (SELECT 1 FROM public.payment_attempts pa WHERE pa.order_id = orders.id);
  GET DIAGNOSTICS v_orphan_pending_deleted = ROW_COUNT;
  
  -- Trigger cart reminder emails for PENDING_PAYMENT orders older than 48h that haven't been reminded yet
  SELECT value INTO v_base_url
  FROM public.admin_settings
  WHERE key = 'edge_function_base_url'
  LIMIT 1;
  
  IF v_base_url IS NULL OR v_base_url = '' THEN
    v_base_url := 'https://igmkhxffnyzoogcqvdab.supabase.co/functions/v1';
  END IF;
  
  -- Count orders needing reminders (exclude orphans - must have items)
  SELECT COUNT(*) INTO v_reminders_triggered
  FROM public.orders
  WHERE status = 'PENDING_PAYMENT'
  AND created_at < now() - interval '48 hours'
  AND cart_reminder_sent_at IS NULL
  AND EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = orders.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_attempts pa 
    WHERE pa.order_id = orders.id AND pa.status IN ('pending', 'paid')
  );
  
  -- If there are orders needing reminders, trigger the edge function
  IF v_reminders_triggered > 0 THEN
    PERFORM net.http_post(
      url := v_base_url || '/send-cart-reminder-emails',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-internal-cron-key', 'afrishop-internal-cron-2026'
      ),
      body := jsonb_build_object('triggered_by', 'cleanup_cron')
    );
  END IF;
  
  -- Cancel stale PENDING_PAYMENT orders after 10 DAYS
  UPDATE public.orders SET status = 'CANCELLED', updated_at = now()
  WHERE status = 'PENDING_PAYMENT'
  AND created_at < now() - interval '10 days'
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_attempts pa 
    WHERE pa.order_id = orders.id AND pa.status IN ('pending', 'paid')
  );
  GET DIAGNOSTICS v_stale_orders_cancelled = ROW_COUNT;
  
  -- Delete empty DRAFT orders older than 7 days
  DELETE FROM public.orders WHERE status = 'DRAFT'
  AND created_at < now() - interval '7 days'
  AND NOT EXISTS (SELECT 1 FROM public.order_items oi WHERE oi.order_id = orders.id);
  GET DIAGNOSTICS v_empty_drafts_deleted = ROW_COUNT;
  
  DELETE FROM public.home_seen_items WHERE seen_at < now() - interval '7 days';
  GET DIAGNOSTICS v_home_seen_items_deleted = ROW_COUNT;
  
  DELETE FROM public.guest_cart_snapshots WHERE updated_at < now() - interval '30 days';
  GET DIAGNOSTICS v_guest_cart_snapshots_deleted = ROW_COUNT;
  
  DELETE FROM public.catalog_facets_cache WHERE expires_at < now();
  GET DIAGNOSTICS v_catalog_facets_cache_deleted = ROW_COUNT;

  DELETE FROM public.product_variants_cache WHERE expires_at < now();
  GET DIAGNOSTICS v_variants_cache_deleted = ROW_COUNT;

  DELETE FROM public.query_translation_cache WHERE expires_at < now();
  GET DIAGNOSTICS v_translation_cache_deleted = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'catalog_cache_deleted', v_catalog_cache_deleted,
    'catalog_rate_limits_deleted', v_catalog_rate_limits_deleted,
    'rate_limits_deleted', v_rate_limits_deleted,
    'product_cache_deleted', v_product_cache_deleted,
    'product_hot_cache_deleted', v_product_hot_cache_deleted,
    'provider_budget_deleted', v_provider_budget_deleted,
    'payment_attempts_expired', v_payment_attempts_expired,
    'orphan_pending_deleted', v_orphan_pending_deleted,
    'reminders_triggered', v_reminders_triggered,
    'stale_orders_cancelled', v_stale_orders_cancelled,
    'empty_drafts_deleted', v_empty_drafts_deleted,
    'home_seen_items_deleted', v_home_seen_items_deleted,
    'guest_cart_snapshots_deleted', v_guest_cart_snapshots_deleted,
    'catalog_facets_cache_deleted', v_catalog_facets_cache_deleted,
    'variants_cache_deleted', v_variants_cache_deleted,
    'translation_cache_deleted', v_translation_cache_deleted,
    'duration_ms', EXTRACT(MILLISECOND FROM clock_timestamp() - v_start_time)::integer,
    'cleanup_at', now()
  );
END;
$function$;
