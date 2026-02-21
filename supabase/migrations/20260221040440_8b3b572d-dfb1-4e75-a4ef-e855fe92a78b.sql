
-- AI Query Rewrite Cache
-- Stores structured AI rewrite results keyed by normalized query + lang
CREATE TABLE public.search_rewrite_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  q_norm TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'fr',
  category_hint TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days')
);

-- Unique index for fast lookup
CREATE UNIQUE INDEX idx_search_rewrite_cache_key ON public.search_rewrite_cache (q_norm, lang);

-- TTL cleanup index
CREATE INDEX idx_search_rewrite_cache_expires ON public.search_rewrite_cache (expires_at);

-- RLS: service role only (edge functions)
ALTER TABLE public.search_rewrite_cache ENABLE ROW LEVEL SECURITY;

-- No public policies — only service_role can read/write
