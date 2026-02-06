
-- Add token_hash column for secure token storage
ALTER TABLE public.admin_invitations ADD COLUMN IF NOT EXISTS token_hash text;

-- Backfill token_hash from existing plaintext tokens using SHA-256
UPDATE public.admin_invitations 
SET token_hash = encode(digest(token, 'sha256'), 'hex')
WHERE token IS NOT NULL AND token_hash IS NULL;

-- Create unique index on token_hash for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_invitations_token_hash 
  ON public.admin_invitations(token_hash) WHERE token_hash IS NOT NULL;

-- Update RLS: allow pending invitations to be queried by token_hash (for client-side validation)
CREATE POLICY "Allow reading pending invitations by token_hash"
  ON public.admin_invitations
  FOR SELECT
  USING (
    status = 'pending' 
    AND expires_at > now()
  );
