
-- Search relevancy reports (one per test run)
CREATE TABLE public.search_relevancy_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  env text NOT NULL DEFAULT 'production',
  total_queries int NOT NULL DEFAULT 0,
  pass_count int NOT NULL DEFAULT 0,
  fail_count int NOT NULL DEFAULT 0,
  avg_latency_ms int NOT NULL DEFAULT 0,
  slow_count int NOT NULL DEFAULT 0
);

ALTER TABLE public.search_relevancy_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read relevancy reports"
  ON public.search_relevancy_reports FOR SELECT
  TO authenticated
  USING (public.is_admin_role());

-- Search relevancy report rows (one per query tested)
CREATE TABLE public.search_relevancy_report_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.search_relevancy_reports(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  category text,
  query text NOT NULL,
  returned_count int NOT NULL DEFAULT 0,
  top3_relevant int NOT NULL DEFAULT 0,
  top12_relevant int NOT NULL DEFAULT 0,
  parts_bleed_rate numeric DEFAULT 0,
  zero_price_count int NOT NULL DEFAULT 0,
  missing_image_count int NOT NULL DEFAULT 0,
  latency_ms int NOT NULL DEFAULT 0,
  provider_amazon_count int NOT NULL DEFAULT 0,
  provider_ebay_count int NOT NULL DEFAULT 0,
  fail_reasons text[] DEFAULT '{}',
  sample_top3_titles text[] DEFAULT '{}',
  debug jsonb DEFAULT '{}'
);

ALTER TABLE public.search_relevancy_report_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read relevancy report rows"
  ON public.search_relevancy_report_rows FOR SELECT
  TO authenticated
  USING (public.is_admin_role());

CREATE INDEX idx_report_rows_report_id ON public.search_relevancy_report_rows(report_id);
CREATE INDEX idx_reports_created_at ON public.search_relevancy_reports(created_at DESC);
