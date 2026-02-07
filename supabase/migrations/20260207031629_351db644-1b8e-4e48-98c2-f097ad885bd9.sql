
-- Table for caching AI query expansions (7-day TTL)
CREATE TABLE public.search_query_expansions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  query_normalized TEXT NOT NULL,
  source_lang TEXT NOT NULL DEFAULT 'fr',
  expanded_terms TEXT[] NOT NULL DEFAULT '{}',
  category_hint TEXT,
  confidence NUMERIC DEFAULT 0.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days')
);

-- Unique index on normalized query for fast lookups
CREATE UNIQUE INDEX idx_search_query_expansions_query ON public.search_query_expansions (query_normalized);

-- Index for TTL cleanup
CREATE INDEX idx_search_query_expansions_expires ON public.search_query_expansions (expires_at);

-- Enable RLS
ALTER TABLE public.search_query_expansions ENABLE ROW LEVEL SECURITY;

-- Public read (search is unauthenticated)
CREATE POLICY "Anyone can read query expansions"
  ON public.search_query_expansions
  FOR SELECT
  USING (true);

-- Only service role can write (edge functions use service_role key)
-- No INSERT/UPDATE/DELETE policies for anon = service-role-only writes
