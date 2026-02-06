
-- Mobile sections cache: stores pre-built strict sections (NOT the mixed pool)
CREATE TABLE IF NOT EXISTS public.catalog_home_mobile_sections_cache (
  env text NOT NULL PRIMARY KEY,
  schema_version integer NOT NULL DEFAULT 1,
  built_at timestamptz NOT NULL DEFAULT now(),
  ttl_seconds integer NOT NULL DEFAULT 3600,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- RLS: only service_role can read/write (edge functions use service_role key)
ALTER TABLE public.catalog_home_mobile_sections_cache ENABLE ROW LEVEL SECURITY;

-- No public policies = only service_role can access
