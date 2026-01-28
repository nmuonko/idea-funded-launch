-- ============================================================
-- Cars Feature: Tables for API cost control, caching, and listings
-- ============================================================

-- Cars API usage tracking (daily/monthly aggregates)
CREATE TABLE public.cars_api_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL DEFAULT CURRENT_DATE,
  month text NOT NULL DEFAULT to_char(CURRENT_DATE, 'YYYY-MM'),
  total_calls integer NOT NULL DEFAULT 0,
  estimated_cost_usd numeric(10, 4) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (day)
);

-- Cars search cache (normalized query results)
CREATE TABLE public.cars_search_cache (
  cache_key text PRIMARY KEY,
  response_json_min jsonb NOT NULL DEFAULT '[]'::jsonb,
  result_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Cars listings cache (individual vehicle listings)
CREATE TABLE public.cars_listings_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'auto_dev',
  provider_listing_id text NOT NULL,
  title text,
  price numeric(12, 2),
  mileage integer,
  year integer,
  make text,
  model text,
  location text,
  image_url text,
  listing_url text,
  vin text,
  is_trending boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_listing_id)
);

-- Cars rate limits (per user/IP tracking)
CREATE TABLE public.cars_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier text NOT NULL,
  identifier_type text NOT NULL CHECK (identifier_type IN ('user', 'ip', 'anon')),
  window_date date NOT NULL DEFAULT CURRENT_DATE,
  request_count integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (identifier, identifier_type, window_date)
);

-- Cars settings (stored in app_settings pattern)
CREATE TABLE public.cars_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Insert default settings
INSERT INTO public.cars_settings (key, value, description) VALUES
  ('cars_api_enabled', 'true', 'Enable/disable cars API calls'),
  ('cars_api_monthly_budget_usd', '50', 'Monthly budget cap in USD'),
  ('cars_api_budget_action', '"show_cached_only"', 'Action when budget exceeded: show_cached_only or degrade_to_request_form'),
  ('cars_search_limits', '{"anon_per_day": 5, "user_per_day": 20, "ip_per_hour": 30}', 'Rate limits for car searches'),
  ('cars_cache_ttl_minutes', '30', 'Cache TTL in minutes for search results'),
  ('cars_api_cost_per_call', '0.01', 'Estimated cost per API call in USD')
ON CONFLICT (key) DO NOTHING;

-- Enable RLS
ALTER TABLE public.cars_api_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cars_search_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cars_listings_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cars_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cars_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Service role only for usage/rate-limits
CREATE POLICY "Service role manages cars_api_usage"
  ON public.cars_api_usage FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role manages cars_rate_limits"
  ON public.cars_rate_limits FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role manages cars_search_cache"
  ON public.cars_search_cache FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Listings cache: public read, service role write
CREATE POLICY "Anyone can read cars listings"
  ON public.cars_listings_cache FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Service role manages cars listings"
  ON public.cars_listings_cache FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

-- Settings: public read, admin write
CREATE POLICY "Anyone can read cars settings"
  ON public.cars_settings FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Admins can update cars settings"
  ON public.cars_settings FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Indexes for performance
CREATE INDEX idx_cars_search_cache_expires ON public.cars_search_cache (expires_at);
CREATE INDEX idx_cars_listings_trending ON public.cars_listings_cache (is_trending) WHERE is_trending = true;
CREATE INDEX idx_cars_listings_updated ON public.cars_listings_cache (updated_at DESC);
CREATE INDEX idx_cars_rate_limits_lookup ON public.cars_rate_limits (identifier, identifier_type, window_date);
CREATE INDEX idx_cars_api_usage_month ON public.cars_api_usage (month);

-- Trigger for updated_at
CREATE TRIGGER update_cars_settings_updated_at
  BEFORE UPDATE ON public.cars_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER update_cars_listings_updated_at
  BEFORE UPDATE ON public.cars_listings_cache
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER update_cars_search_cache_updated_at
  BEFORE UPDATE ON public.cars_search_cache
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();