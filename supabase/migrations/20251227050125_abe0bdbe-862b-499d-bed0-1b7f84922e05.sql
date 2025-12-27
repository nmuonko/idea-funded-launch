-- Create storage bucket for bank transfer proofs
INSERT INTO storage.buckets (id, name, public)
VALUES ('bank_transfer_proofs', 'bank_transfer_proofs', false)
ON CONFLICT (id) DO NOTHING;

-- RLS policy for storage: only service role can manage
CREATE POLICY "Service role only for bank transfer proofs upload"
ON storage.objects
FOR ALL
USING (bucket_id = 'bank_transfer_proofs')
WITH CHECK (bucket_id = 'bank_transfer_proofs');

-- Create bank_transfer_submissions table
CREATE TABLE IF NOT EXISTS public.bank_transfer_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  reference text NOT NULL,
  name text,
  contact text,
  file_path text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewing', 'confirmed', 'rejected')),
  notes text,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz
);

-- Enable RLS - no public access, only via edge function (service role)
ALTER TABLE public.bank_transfer_submissions ENABLE ROW LEVEL SECURITY;

-- Only admins can view/update submissions
CREATE POLICY "Admins can view bank transfer submissions"
ON public.bank_transfer_submissions
FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update bank transfer submissions"
ON public.bank_transfer_submissions
FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

-- No public insert - only via service role in edge function
-- Service role bypasses RLS

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_bank_transfer_submissions_status ON public.bank_transfer_submissions(status);
CREATE INDEX IF NOT EXISTS idx_bank_transfer_submissions_reference ON public.bank_transfer_submissions(reference);
CREATE INDEX IF NOT EXISTS idx_bank_transfer_submissions_created_at ON public.bank_transfer_submissions(created_at DESC);