
-- Search query log for analytics and auto-seed promotion
CREATE TABLE IF NOT EXISTS public.search_query_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  q_norm text NOT NULL,
  q_original text,
  category_guess text,
  db_count integer DEFAULT 0,
  live_count integer DEFAULT 0,
  used_live boolean DEFAULT false,
  fuzzy_used boolean DEFAULT false,
  expansion_used boolean DEFAULT false,
  auto_cached_count integer DEFAULT 0,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for analytics queries
CREATE INDEX idx_search_query_log_created ON public.search_query_log (created_at DESC);
CREATE INDEX idx_search_query_log_qnorm ON public.search_query_log (q_norm);

-- Enable RLS
ALTER TABLE public.search_query_log ENABLE ROW LEVEL SECURITY;

-- Service role only (edge functions write, no public access)
CREATE POLICY "Service role full access on search_query_log"
  ON public.search_query_log
  FOR ALL
  USING (false)
  WITH CHECK (false);
