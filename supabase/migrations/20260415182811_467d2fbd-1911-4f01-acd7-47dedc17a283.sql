
-- Create product bundles table
CREATE TABLE public.product_bundles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create bundle items table
CREATE TABLE public.product_bundle_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bundle_id UUID NOT NULL REFERENCES public.product_bundles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  price_usd NUMERIC NOT NULL DEFAULT 0,
  image_url TEXT,
  product_url TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.product_bundles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_bundle_items ENABLE ROW LEVEL SECURITY;

-- Public can read active bundles (for shared links)
CREATE POLICY "Anyone can view active bundles"
ON public.product_bundles FOR SELECT
USING (is_active = true AND (expires_at IS NULL OR expires_at > now()));

-- Admins can manage bundles
CREATE POLICY "Admins can manage bundles"
ON public.product_bundles FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid()));

-- Public can read items of active bundles
CREATE POLICY "Anyone can view items of active bundles"
ON public.product_bundle_items FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.product_bundles 
  WHERE id = bundle_id AND is_active = true AND (expires_at IS NULL OR expires_at > now())
));

-- Admins can manage bundle items
CREATE POLICY "Admins can manage bundle items"
ON public.product_bundle_items FOR ALL
TO authenticated
USING (EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid()));

-- Index for performance
CREATE INDEX idx_product_bundle_items_bundle_id ON public.product_bundle_items(bundle_id);
CREATE INDEX idx_product_bundles_active ON public.product_bundles(is_active, expires_at);

-- Updated at trigger
CREATE TRIGGER update_product_bundles_updated_at
BEFORE UPDATE ON public.product_bundles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
