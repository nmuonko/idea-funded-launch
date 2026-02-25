
-- 1) Amazon ingest queue table
CREATE TABLE IF NOT EXISTS public.amazon_ingest_queue (
  id bigserial PRIMARY KEY,
  query text NOT NULL,
  category_key text NULL,
  reason text NOT NULL DEFAULT 'cache_miss',
  priority int NOT NULL DEFAULT 5,
  status text NOT NULL DEFAULT 'queued',
  attempts int NOT NULL DEFAULT 0,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS amazon_ingest_queue_status_priority
  ON public.amazon_ingest_queue(status, priority, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS amazon_ingest_queue_query_unique
  ON public.amazon_ingest_queue(query) WHERE status = 'queued';

-- 2) Add 'month' support to check_provider_budget
CREATE OR REPLACE FUNCTION public.check_provider_budget(
  p_provider TEXT,
  p_window_type TEXT,
  p_limit INTEGER DEFAULT 100
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_key TEXT;
  v_window_start TIMESTAMPTZ;
  v_current_count INTEGER := 0;
  v_allowed BOOLEAN;
  v_remaining INTEGER;
BEGIN
  IF p_window_type = 'hour' THEN
    v_window_start := date_trunc('hour', now());
    v_window_key := p_provider || ':hour:' || to_char(v_window_start, 'YYYY-MM-DD"T"HH24');
  ELSIF p_window_type = 'month' THEN
    v_window_start := date_trunc('month', now());
    v_window_key := p_provider || ':month:' || to_char(v_window_start, 'YYYY-MM');
  ELSE
    v_window_start := date_trunc('day', now());
    v_window_key := p_provider || ':day:' || to_char(v_window_start, 'YYYY-MM-DD');
  END IF;

  SELECT call_count INTO v_current_count
  FROM public.provider_budget
  WHERE window_key = v_window_key;

  v_current_count := COALESCE(v_current_count, 0);
  v_allowed := v_current_count < p_limit;
  v_remaining := GREATEST(0, p_limit - v_current_count);

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'count', v_current_count,
    'limit', p_limit,
    'remaining', v_remaining,
    'window_key', v_window_key
  );
END;
$$;

-- 3) Add 'month' support to increment_provider_budget
CREATE OR REPLACE FUNCTION public.increment_provider_budget(
  p_provider TEXT,
  p_window_type TEXT,
  p_limit INTEGER DEFAULT 100
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_key TEXT;
  v_window_start TIMESTAMPTZ;
  v_current_count INTEGER;
  v_allowed BOOLEAN;
  v_remaining INTEGER;
BEGIN
  IF p_window_type = 'hour' THEN
    v_window_start := date_trunc('hour', now());
    v_window_key := p_provider || ':hour:' || to_char(v_window_start, 'YYYY-MM-DD"T"HH24');
  ELSIF p_window_type = 'month' THEN
    v_window_start := date_trunc('month', now());
    v_window_key := p_provider || ':month:' || to_char(v_window_start, 'YYYY-MM');
  ELSE
    v_window_start := date_trunc('day', now());
    v_window_key := p_provider || ':day:' || to_char(v_window_start, 'YYYY-MM-DD');
  END IF;

  INSERT INTO public.provider_budget (provider, window_type, window_key, window_start, call_count, limit_count)
  VALUES (p_provider, p_window_type, v_window_key, v_window_start, 1, p_limit)
  ON CONFLICT (window_key) DO UPDATE SET
    call_count = provider_budget.call_count + 1,
    updated_at = now()
  RETURNING call_count INTO v_current_count;

  v_allowed := v_current_count <= p_limit;
  v_remaining := GREATEST(0, p_limit - v_current_count);

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'count', v_current_count,
    'limit', p_limit,
    'remaining', v_remaining,
    'window_key', v_window_key,
    'window_start', v_window_start
  );
END;
$$;
