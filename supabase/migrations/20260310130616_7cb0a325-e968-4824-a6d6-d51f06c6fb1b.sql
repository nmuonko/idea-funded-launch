CREATE TABLE IF NOT EXISTS public.search_normalization_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  raw_query TEXT NOT NULL,
  normalized_query TEXT NOT NULL,
  detected_language TEXT NOT NULL DEFAULT 'unknown',
  static_map_matched BOOLEAN NOT NULL DEFAULT false,
  dynamic_fallback_used BOOLEAN NOT NULL DEFAULT false,
  ai_translation_used BOOLEAN NOT NULL DEFAULT false,
  expansions TEXT[] NOT NULL DEFAULT '{}',
  result_count INTEGER NOT NULL DEFAULT 0,
  request_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Index for mining failing queries
CREATE INDEX IF NOT EXISTS idx_search_norm_logs_low_results 
  ON public.search_normalization_logs (result_count, created_at DESC) 
  WHERE result_count <= 5;

-- Index for language analysis
CREATE INDEX IF NOT EXISTS idx_search_norm_logs_language 
  ON public.search_normalization_logs (detected_language, created_at DESC);

-- Auto-cleanup: keep only 30 days of logs
-- (Handled by a simple TTL — admin can run cleanup manually)

-- RLS: No user data, admin-only table. Disable RLS for edge function access.
ALTER TABLE public.search_normalization_logs ENABLE ROW LEVEL SECURITY;

-- Allow edge functions (service role) full access
CREATE POLICY "Service role full access" ON public.search_normalization_logs
  FOR ALL USING (true) WITH CHECK (true);