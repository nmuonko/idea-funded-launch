
-- 1. Fix referrers PII exposure: drop public SELECT policy
DROP POLICY IF EXISTS "Anyone can lookup referrers by email" ON public.referrers;

-- Create a secure function for ref_code validation (used by GetApp.tsx)
CREATE OR REPLACE FUNCTION public.validate_ref_code(code text)
RETURNS TABLE(id uuid, status text, ref_code text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.status, r.ref_code
  FROM public.referrers r
  WHERE r.ref_code = code
  LIMIT 1;
$$;

-- 2. Fix admin invitations enumeration: drop broad SELECT for public role
DROP POLICY IF EXISTS "Allow reading pending invitations by token_hash" ON public.admin_invitations;

-- Create a secure function for token validation (used by AcceptInvite.tsx)
CREATE OR REPLACE FUNCTION public.verify_invitation_token(token_hash_input text)
RETURNS TABLE(id uuid, email text, role text, status text, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.id, i.email, i.role, i.status, i.expires_at
  FROM public.admin_invitations i
  WHERE i.token_hash = token_hash_input
    AND i.status = 'pending'
    AND i.expires_at > now()
  LIMIT 1;
$$;

-- 3. Fix search_normalization_logs: drop public write policy and re-create for service_role only
DROP POLICY IF EXISTS "Service role full access" ON public.search_normalization_logs;

CREATE POLICY "Service role full access"
  ON public.search_normalization_logs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
