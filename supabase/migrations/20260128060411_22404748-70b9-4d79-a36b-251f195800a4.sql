-- Enable RLS on catalog_cache_settings (if not already enabled)
ALTER TABLE public.catalog_cache_settings ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Admins can read cache settings" ON public.catalog_cache_settings;
DROP POLICY IF EXISTS "Admins can update cache settings" ON public.catalog_cache_settings;
DROP POLICY IF EXISTS "Service role full access" ON public.catalog_cache_settings;

-- Only admins can read cache settings
CREATE POLICY "Admins can read cache settings"
ON public.catalog_cache_settings
FOR SELECT
TO authenticated
USING (public.is_admin());

-- Only admins can update cache settings
CREATE POLICY "Admins can update cache settings"
ON public.catalog_cache_settings
FOR UPDATE
TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Allow service role to insert (for seeding)
CREATE POLICY "Service role can insert cache settings"
ON public.catalog_cache_settings
FOR INSERT
TO service_role
WITH CHECK (true);

-- Ensure default row exists (seed if missing)
INSERT INTO public.catalog_cache_settings (
  key,
  home_stale_minutes,
  home_expires_minutes,
  search_stale_minutes,
  search_expires_minutes,
  offers_stale_minutes,
  offers_expires_minutes,
  negative_expires_seconds,
  updated_at
)
VALUES (
  'default',
  180,
  1440,
  240,
  2880,
  180,
  720,
  120,
  now()
)
ON CONFLICT (key) DO NOTHING;