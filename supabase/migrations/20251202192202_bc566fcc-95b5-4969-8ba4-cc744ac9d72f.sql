-- Add admin_permissions table for granular role-based access control
CREATE TABLE IF NOT EXISTS public.admin_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role text NOT NULL DEFAULT 'operations',
  invited_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at timestamp with time zone NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.admin_invitations ENABLE ROW LEVEL SECURITY;

-- Policies for admin invitations
CREATE POLICY "Admins can view all invitations" ON public.admin_invitations
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can create invitations" ON public.admin_invitations
  FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update invitations" ON public.admin_invitations
  FOR UPDATE USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Anyone can view their pending invitation by token" ON public.admin_invitations
  FOR SELECT USING (status = 'pending' AND expires_at > now());

-- Add index for token lookups
CREATE INDEX idx_admin_invitations_token ON public.admin_invitations(token);
CREATE INDEX idx_admin_invitations_email ON public.admin_invitations(email);