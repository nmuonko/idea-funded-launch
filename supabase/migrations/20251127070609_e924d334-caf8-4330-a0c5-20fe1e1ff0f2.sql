-- Add CSAT rating fields to support_tickets
ALTER TABLE public.support_tickets
ADD COLUMN rating INTEGER CHECK (rating >= 1 AND rating <= 5),
ADD COLUMN rated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN escalated BOOLEAN DEFAULT false,
ADD COLUMN escalated_at TIMESTAMP WITH TIME ZONE;

-- Create knowledge base articles table
CREATE TABLE public.knowledge_base_articles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  published BOOLEAN DEFAULT false,
  view_count INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID NOT NULL
);

-- Enable RLS on knowledge base articles
ALTER TABLE public.knowledge_base_articles ENABLE ROW LEVEL SECURITY;

-- Anyone can view published articles
CREATE POLICY "Anyone can view published articles"
ON public.knowledge_base_articles
FOR SELECT
USING (published = true);

-- Admins can manage all articles
CREATE POLICY "Admins can manage articles"
ON public.knowledge_base_articles
FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add trigger for updated_at
CREATE TRIGGER update_knowledge_base_articles_updated_at
BEFORE UPDATE ON public.knowledge_base_articles
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();