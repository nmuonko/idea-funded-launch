
CREATE TABLE public.hot_product_clicks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  provider_product_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'unknown',
  event_type TEXT NOT NULL DEFAULT 'click',
  source TEXT NOT NULL DEFAULT 'web',
  referrer_code TEXT,
  session_id TEXT,
  user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.hot_product_clicks ENABLE ROW LEVEL SECURITY;

-- Allow anyone to insert click events (anonymous tracking)
CREATE POLICY "Anyone can insert hot product clicks"
ON public.hot_product_clicks
FOR INSERT
WITH CHECK (true);

-- Only admins can read click data
CREATE POLICY "Admins can view hot product clicks"
ON public.hot_product_clicks
FOR SELECT
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid())
);

-- Index for analytics queries
CREATE INDEX idx_hot_product_clicks_product ON public.hot_product_clicks (provider_product_id, provider);
CREATE INDEX idx_hot_product_clicks_created ON public.hot_product_clicks (created_at DESC);
CREATE INDEX idx_hot_product_clicks_event ON public.hot_product_clicks (event_type);
