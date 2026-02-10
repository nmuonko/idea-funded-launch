
-- Chat routing configuration for round-robin assignment
CREATE TABLE public.chat_routing_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_user_id UUID NOT NULL,
  admin_email TEXT,
  admin_name TEXT,
  is_available BOOLEAN NOT NULL DEFAULT true,
  priority_order INT NOT NULL DEFAULT 0,
  chats_assigned_count INT NOT NULL DEFAULT 0,
  last_assigned_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.chat_routing_config ENABLE ROW LEVEL SECURITY;

-- Admin users can read/write chat routing config
CREATE POLICY "Admin users can view chat routing config"
ON public.chat_routing_config
FOR SELECT
USING (
  EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid())
);

CREATE POLICY "Admin users can insert chat routing config"
ON public.chat_routing_config
FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid())
);

CREATE POLICY "Admin users can update chat routing config"
ON public.chat_routing_config
FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid())
);

CREATE POLICY "Admin users can delete chat routing config"
ON public.chat_routing_config
FOR DELETE
USING (
  EXISTS (SELECT 1 FROM public.admin_users WHERE id = auth.uid())
);

-- Trigger for updated_at
CREATE TRIGGER update_chat_routing_config_updated_at
BEFORE UPDATE ON public.chat_routing_config
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
