-- Create home_seen_items table for repeat avoidance
-- This table tracks which items were shown in each home section to avoid repetition

CREATE TABLE IF NOT EXISTS public.home_seen_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  section_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_item_id TEXT NOT NULL,
  rotation_key TEXT NOT NULL,
  seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(section_key, provider, provider_item_id)
);

-- Index for efficient cleanup and lookup
CREATE INDEX IF NOT EXISTS idx_home_seen_items_section_seen 
  ON public.home_seen_items(section_key, seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_home_seen_items_rotation 
  ON public.home_seen_items(rotation_key);

-- RLS policies
ALTER TABLE public.home_seen_items ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (edge functions)
CREATE POLICY "Service role full access on home_seen_items"
  ON public.home_seen_items
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Cleanup function to remove old entries
CREATE OR REPLACE FUNCTION public.cleanup_home_seen_items(p_days_to_keep INTEGER DEFAULT 7)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  DELETE FROM public.home_seen_items 
  WHERE seen_at < now() - (p_days_to_keep || ' days')::interval;
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'cleanup_at', now()
  );
END;
$$;

COMMENT ON TABLE public.home_seen_items IS 'Tracks items shown in home sections to avoid repetition within home_avoid_repeat_days';