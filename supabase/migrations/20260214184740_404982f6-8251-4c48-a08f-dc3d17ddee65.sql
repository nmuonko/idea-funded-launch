
-- =============================================
-- 1. Batch dual rate limit function (single DB round-trip)
-- =============================================
CREATE OR REPLACE FUNCTION public.check_dual_rate_limit(
  p_user_key text,
  p_ip_key text,
  p_user_limit integer,
  p_ip_limit integer,
  p_window_minutes integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_count integer;
  v_user_window_start timestamptz;
  v_user_reset_at timestamptz;
  v_ip_count integer;
  v_ip_window_start timestamptz;
  v_ip_reset_at timestamptz;
  v_user_allowed boolean;
  v_ip_allowed boolean;
BEGIN
  -- Atomic upsert for user key
  INSERT INTO public.rate_limits (key, count, window_start, expires_at)
  VALUES (
    p_user_key, 1, now(),
    now() + (p_window_minutes || ' minutes')::interval
  )
  ON CONFLICT (key) DO UPDATE SET
    count = CASE 
      WHEN rate_limits.window_start + (p_window_minutes || ' minutes')::interval < now() 
      THEN 1
      ELSE rate_limits.count + 1
    END,
    window_start = CASE 
      WHEN rate_limits.window_start + (p_window_minutes || ' minutes')::interval < now() 
      THEN now()
      ELSE rate_limits.window_start
    END,
    expires_at = CASE 
      WHEN rate_limits.window_start + (p_window_minutes || ' minutes')::interval < now() 
      THEN now() + (p_window_minutes || ' minutes')::interval
      ELSE rate_limits.expires_at
    END
  RETURNING count, window_start, expires_at
  INTO v_user_count, v_user_window_start, v_user_reset_at;

  -- Atomic upsert for IP key
  INSERT INTO public.rate_limits (key, count, window_start, expires_at)
  VALUES (
    p_ip_key, 1, now(),
    now() + (p_window_minutes || ' minutes')::interval
  )
  ON CONFLICT (key) DO UPDATE SET
    count = CASE 
      WHEN rate_limits.window_start + (p_window_minutes || ' minutes')::interval < now() 
      THEN 1
      ELSE rate_limits.count + 1
    END,
    window_start = CASE 
      WHEN rate_limits.window_start + (p_window_minutes || ' minutes')::interval < now() 
      THEN now()
      ELSE rate_limits.window_start
    END,
    expires_at = CASE 
      WHEN rate_limits.window_start + (p_window_minutes || ' minutes')::interval < now() 
      THEN now() + (p_window_minutes || ' minutes')::interval
      ELSE rate_limits.expires_at
    END
  RETURNING count, window_start, expires_at
  INTO v_ip_count, v_ip_window_start, v_ip_reset_at;

  v_user_allowed := v_user_count <= p_user_limit;
  v_ip_allowed := v_ip_count <= p_ip_limit;

  RETURN jsonb_build_object(
    'user_result', jsonb_build_object(
      'allowed', v_user_allowed,
      'count', v_user_count,
      'limit', p_user_limit,
      'remaining', GREATEST(0, p_user_limit - v_user_count),
      'reset_at', v_user_reset_at
    ),
    'ip_result', jsonb_build_object(
      'allowed', v_ip_allowed,
      'count', v_ip_count,
      'limit', p_ip_limit,
      'remaining', GREATEST(0, p_ip_limit - v_ip_count),
      'reset_at', v_ip_reset_at
    ),
    'allowed', v_user_allowed AND v_ip_allowed,
    'blocked_by', CASE
      WHEN NOT v_user_allowed THEN 'user'
      WHEN NOT v_ip_allowed THEN 'ip'
      ELSE null
    END
  );
END;
$$;

-- =============================================
-- 2. Composite indexes for hot query paths
-- =============================================

-- Index for catalog_cache lookups (cache_key + expires_at)
CREATE INDEX IF NOT EXISTS idx_catalog_cache_key_expires
ON public.catalog_cache (cache_key, expires_at);

-- Index for cart queries (order_items by order + saved status)
CREATE INDEX IF NOT EXISTS idx_order_items_order_saved
ON public.order_items (order_id, is_saved_for_later);

-- Partial index for active cart lookups (DRAFT orders per user)
CREATE INDEX IF NOT EXISTS idx_orders_user_draft
ON public.orders (user_id) WHERE status = 'DRAFT';

-- Index for rate_limits key lookups (hot path)
CREATE INDEX IF NOT EXISTS idx_rate_limits_key
ON public.rate_limits (key);
