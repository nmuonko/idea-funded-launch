-- Migration 6: Create RPC functions for payment processing

-- Function 1: generate_cart_hash_from_order
-- Computes deterministic SHA256 hash from DB order_items (server-side only)
CREATE OR REPLACE FUNCTION public.generate_cart_hash_from_order(
  p_order_id uuid,
  p_currency text,
  p_payment_method text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_data text;
BEGIN
  -- Build deterministic string from order items
  -- Sort by store, product_url, quantity, unit_price for consistency
  SELECT string_agg(
    item_data, '|' ORDER BY item_data
  ) INTO v_data
  FROM (
    SELECT 
      COALESCE(store::text, '') || ':' || 
      COALESCE(product_url, '') || ':' || 
      COALESCE(quantity::text, '1') || ':' || 
      COALESCE(ROUND(base_price_usd::numeric, 2)::text, '0.00') AS item_data
    FROM public.order_items
    WHERE order_id = p_order_id
      AND is_saved_for_later = false
    ORDER BY store, product_url, quantity, base_price_usd
  ) items;
  
  -- Append currency and payment method
  v_data := COALESCE(v_data, '') || '|' || p_currency || '|' || p_payment_method;
  
  -- Compute SHA256 hash
  v_hash := encode(digest(v_data, 'sha256'), 'hex');
  
  RETURN v_hash;
END;
$$;

-- Function 2: check_rate_limit
-- Atomic rate limit check and update
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key text,
  p_limit integer,
  p_window_minutes integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_count integer;
  v_window_start timestamptz;
  v_reset_at timestamptz;
  v_allowed boolean;
BEGIN
  -- Atomic upsert with window check
  INSERT INTO public.rate_limits (key, count, window_start, expires_at)
  VALUES (
    p_key, 
    1, 
    now(), 
    now() + (p_window_minutes || ' minutes')::interval
  )
  ON CONFLICT (key) DO UPDATE SET
    count = CASE 
      WHEN rate_limits.window_start + (p_window_minutes || ' minutes')::interval < now() 
      THEN 1  -- Reset window
      ELSE rate_limits.count + 1  -- Increment
    END,
    window_start = CASE 
      WHEN rate_limits.window_start + (p_window_minutes || ' minutes')::interval < now() 
      THEN now()  -- Reset window
      ELSE rate_limits.window_start  -- Keep existing
    END,
    expires_at = CASE 
      WHEN rate_limits.window_start + (p_window_minutes || ' minutes')::interval < now() 
      THEN now() + (p_window_minutes || ' minutes')::interval
      ELSE rate_limits.expires_at
    END
  RETURNING count, window_start, expires_at INTO v_count, v_window_start, v_reset_at;
  
  v_allowed := v_count <= p_limit;
  
  v_result := jsonb_build_object(
    'allowed', v_allowed,
    'count', v_count,
    'limit', p_limit,
    'remaining', GREATEST(0, p_limit - v_count),
    'reset_at', v_reset_at
  );
  
  RETURN v_result;
END;
$$;

-- Function 3: finalize_paid_order
-- Atomically marks an order as PAID with all related updates
CREATE OR REPLACE FUNCTION public.finalize_paid_order(
  p_order_id uuid,
  p_payment_ref text,
  p_operator_ref text DEFAULT NULL,
  p_trace_id text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_result jsonb;
  v_now timestamptz := now();
BEGIN
  -- Lock the order row to prevent concurrent updates
  SELECT id, status, user_id, total_usd
  INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ORDER_NOT_FOUND',
      'message', 'Order not found'
    );
  END IF;
  
  -- Idempotent: if already PAID, return success without updating
  IF v_order.status = 'PAID' THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'message', 'Order already paid',
      'order_id', v_order.id
    );
  END IF;
  
  -- Only allow finalization from PENDING_PAYMENT status
  IF v_order.status != 'PENDING_PAYMENT' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_STATUS',
      'message', 'Order is not in PENDING_PAYMENT status',
      'current_status', v_order.status::text
    );
  END IF;
  
  -- Update order to PAID
  UPDATE public.orders SET
    status = 'PAID'::order_status,
    maisha_payment_status = 'SUCCESS',
    operator_ref_id = COALESCE(p_operator_ref, operator_ref_id),
    payment_verified_at = v_now,
    updated_at = v_now
  WHERE id = p_order_id;
  
  -- Update maisha_payments to paid
  UPDATE public.maisha_payments SET
    status = 'paid',
    paid_at = v_now,
    maishapay_operator_ref_id = COALESCE(p_operator_ref, maishapay_operator_ref_id),
    maishapay_transaction_ref_id = COALESCE(p_payment_ref, maishapay_transaction_ref_id),
    updated_at = v_now
  WHERE order_id = p_order_id;
  
  -- Update payment_attempts if exists
  UPDATE public.payment_attempts SET
    status = 'paid',
    provider_ref = COALESCE(p_payment_ref, provider_ref),
    updated_at = v_now
  WHERE order_id = p_order_id AND status = 'pending';
  
  -- Log to audit if trace_id provided
  IF p_trace_id IS NOT NULL THEN
    INSERT INTO public.system_audit_log (
      trace_id, event_type, user_id, order_id, payload
    ) VALUES (
      p_trace_id,
      'ORDER_FINALIZED_PAID',
      v_order.user_id,
      p_order_id,
      jsonb_build_object(
        'payment_ref', p_payment_ref,
        'operator_ref', p_operator_ref,
        'amount', v_order.total_usd
      )
    );
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'message', 'Order marked as paid',
    'order_id', v_order.id,
    'finalized_at', v_now
  );
END;
$$;

-- Function 4: cleanup_expired_records
-- Cleans up expired rate limits and marks expired payment attempts
CREATE OR REPLACE FUNCTION public.cleanup_expired_records()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate_limits_deleted integer;
  v_attempts_expired integer;
  v_price_cache_deleted integer;
  v_product_cache_deleted integer;
BEGIN
  -- Delete expired rate limits
  DELETE FROM public.rate_limits 
  WHERE expires_at < now();
  GET DIAGNOSTICS v_rate_limits_deleted = ROW_COUNT;
  
  -- Mark expired payment attempts as 'expired'
  UPDATE public.payment_attempts 
  SET status = 'expired', updated_at = now()
  WHERE status = 'pending' AND expires_at < now();
  GET DIAGNOSTICS v_attempts_expired = ROW_COUNT;
  
  -- Clean expired price cache
  DELETE FROM public.price_cache WHERE expires_at < now();
  GET DIAGNOSTICS v_price_cache_deleted = ROW_COUNT;
  
  -- Clean expired product cache
  DELETE FROM public.product_cache WHERE expires_at < now();
  GET DIAGNOSTICS v_product_cache_deleted = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'rate_limits_deleted', v_rate_limits_deleted,
    'payment_attempts_expired', v_attempts_expired,
    'price_cache_deleted', v_price_cache_deleted,
    'product_cache_deleted', v_product_cache_deleted,
    'cleanup_at', now()
  );
END;
$$;