
-- Create marketer_thresholds table
CREATE TABLE public.marketer_thresholds (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  marketer_name text NOT NULL,
  ref_code text NOT NULL UNIQUE,
  threshold_count int NOT NULL DEFAULT 100,
  is_enabled boolean NOT NULL DEFAULT true,
  last_notified_count int DEFAULT 0,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.marketer_thresholds ENABLE ROW LEVEL SECURITY;

-- Admin-only policies (admin_users table check)
CREATE POLICY "Admin can read marketer_thresholds"
  ON public.marketer_thresholds FOR SELECT
  USING (EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid()));

CREATE POLICY "Admin can insert marketer_thresholds"
  ON public.marketer_thresholds FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid()));

CREATE POLICY "Admin can update marketer_thresholds"
  ON public.marketer_thresholds FOR UPDATE
  USING (EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid()));

CREATE POLICY "Admin can delete marketer_thresholds"
  ON public.marketer_thresholds FOR DELETE
  USING (EXISTS (SELECT 1 FROM admin_users WHERE id = auth.uid()));

-- Trigger for updated_at
CREATE TRIGGER update_marketer_thresholds_updated_at
  BEFORE UPDATE ON public.marketer_thresholds
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
