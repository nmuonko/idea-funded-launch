-- Create customer tags table
CREATE TABLE public.customer_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Create customer tag assignments junction table
CREATE TABLE public.customer_tag_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL,
  tag_id UUID NOT NULL REFERENCES public.customer_tags(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  assigned_by UUID REFERENCES auth.users(id),
  UNIQUE(customer_id, tag_id)
);

-- Create customer email logs table
CREATE TABLE public.customer_email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL,
  customer_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  sent_by UUID NOT NULL REFERENCES auth.users(id),
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'sent'
);

-- Enable RLS
ALTER TABLE public.customer_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_email_logs ENABLE ROW LEVEL SECURITY;

-- RLS policies for customer_tags
CREATE POLICY "Admins can manage customer tags"
ON public.customer_tags FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- RLS policies for customer_tag_assignments
CREATE POLICY "Admins can manage tag assignments"
ON public.customer_tag_assignments FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- RLS policies for customer_email_logs
CREATE POLICY "Admins can manage email logs"
ON public.customer_email_logs FOR ALL
USING (public.has_role(auth.uid(), 'admin'));

-- Insert default tags
INSERT INTO public.customer_tags (name, color, description) VALUES
  ('VIP', '#eab308', 'High-value customers with significant purchase history'),
  ('New', '#22c55e', 'Recently registered customers'),
  ('At Risk', '#ef4444', 'Customers who may churn'),
  ('Loyal', '#8b5cf6', 'Repeat customers with consistent orders'),
  ('Wholesale', '#06b6d4', 'Business or bulk buyers');