
CREATE TABLE public.hot_product_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  products jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved_by uuid,
  approved_at timestamptz,
  sent_at timestamptz,
  sent_count int NOT NULL DEFAULT 0,
  failed_count int NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hot_product_campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage hot_product_campaigns"
ON public.hot_product_campaigns
FOR ALL
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid())
);
