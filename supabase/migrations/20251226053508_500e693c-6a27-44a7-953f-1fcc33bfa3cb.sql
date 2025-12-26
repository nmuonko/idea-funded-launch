-- Create manual_transfer_sessions table
CREATE TABLE public.manual_transfer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  reference text NOT NULL,
  upload_token text UNIQUE NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'submitted', 'expired')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_manual_transfer_sessions_order_id ON public.manual_transfer_sessions(order_id);
CREATE INDEX idx_manual_transfer_sessions_upload_token ON public.manual_transfer_sessions(upload_token);
CREATE INDEX idx_manual_transfer_sessions_status ON public.manual_transfer_sessions(status);

-- Enable RLS
ALTER TABLE public.manual_transfer_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Admin only (service role handles public access via edge functions)
CREATE POLICY "Admins can view all manual transfer sessions"
ON public.manual_transfer_sessions
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update manual transfer sessions"
ON public.manual_transfer_sessions
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create manual_transfer_proofs table
CREATE TABLE public.manual_transfer_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.manual_transfer_sessions(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  reference text NOT NULL,
  file_path text NOT NULL,
  original_filename text,
  mime_type text,
  size_bytes integer,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for proofs
CREATE INDEX idx_manual_transfer_proofs_session_id ON public.manual_transfer_proofs(session_id);
CREATE INDEX idx_manual_transfer_proofs_order_id ON public.manual_transfer_proofs(order_id);
CREATE INDEX idx_manual_transfer_proofs_status ON public.manual_transfer_proofs(status);

-- Enable RLS
ALTER TABLE public.manual_transfer_proofs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for proofs: Admin only
CREATE POLICY "Admins can view all manual transfer proofs"
ON public.manual_transfer_proofs
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update manual transfer proofs"
ON public.manual_transfer_proofs
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create private storage bucket for payment proofs
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-proofs',
  'payment-proofs',
  false,
  10485760, -- 10MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
);

-- Storage policies for payment-proofs bucket
CREATE POLICY "Admins can view payment proofs"
ON storage.objects
FOR SELECT
USING (bucket_id = 'payment-proofs' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete payment proofs"
ON storage.objects
FOR DELETE
USING (bucket_id = 'payment-proofs' AND has_role(auth.uid(), 'admin'::app_role));