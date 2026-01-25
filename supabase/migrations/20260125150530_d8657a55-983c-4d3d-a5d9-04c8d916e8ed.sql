-- Add scrape metadata columns to product_cache for tracking and debugging
ALTER TABLE product_cache 
ADD COLUMN IF NOT EXISTS last_scrape_status text,
ADD COLUMN IF NOT EXISTS last_scrape_error text,
ADD COLUMN IF NOT EXISTS scrape_attempt_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_scrape_at timestamptz;

-- Create index for finding failed scrapes
CREATE INDEX IF NOT EXISTS idx_product_cache_scrape_status ON product_cache(last_scrape_status) WHERE last_scrape_status IS NOT NULL;

-- Create scrape retry queue table for failed scrapes
CREATE TABLE IF NOT EXISTS scrape_retry_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_url text NOT NULL UNIQUE,
  store text,
  failure_reason text,
  attempt_count integer DEFAULT 1,
  last_attempt_at timestamptz DEFAULT now(),
  next_retry_at timestamptz DEFAULT (now() + interval '1 hour'),
  created_at timestamptz DEFAULT now()
);

-- RLS for scrape_retry_queue - admin only
ALTER TABLE scrape_retry_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage scrape retry queue" 
ON scrape_retry_queue 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Service role can manage for edge functions
CREATE POLICY "Service role can manage scrape retry queue"
ON scrape_retry_queue
FOR ALL
USING (true)
WITH CHECK (true);