-- =============================================
-- GUEST CART SNAPSHOTS TABLE
-- Stores guest cart state for merge on login
-- =============================================

-- Create guest_cart_snapshots table
CREATE TABLE IF NOT EXISTS public.guest_cart_snapshots (
  device_id TEXT PRIMARY KEY,
  cart_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add comment
COMMENT ON TABLE public.guest_cart_snapshots IS 'Stores guest cart state by device_id for seamless merge to user cart on login';

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION public.update_guest_cart_snapshots_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public';

CREATE TRIGGER update_guest_cart_snapshots_updated_at
  BEFORE UPDATE ON public.guest_cart_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION public.update_guest_cart_snapshots_updated_at();

-- Enable RLS (but no direct access - only via service role edge functions)
ALTER TABLE public.guest_cart_snapshots ENABLE ROW LEVEL SECURITY;

-- Service role only policy (no direct client access)
CREATE POLICY "Service role only" ON public.guest_cart_snapshots
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Create index for cleanup operations
CREATE INDEX IF NOT EXISTS idx_guest_cart_snapshots_updated_at 
  ON public.guest_cart_snapshots(updated_at);

-- =============================================
-- STRENGTHEN PAYMENT_ATTEMPTS RLS FOR EMAIL VERIFICATION
-- =============================================

-- Drop existing policy and recreate with email verification
DROP POLICY IF EXISTS "Users can create payment attempts" ON public.payment_attempts;

CREATE POLICY "Users can create payment attempts" 
ON public.payment_attempts 
FOR INSERT 
TO authenticated
WITH CHECK (
  auth.uid() = user_id 
  AND public.is_email_verified() = true
);

-- =============================================
-- CLEANUP FUNCTION FOR OLD GUEST CART SNAPSHOTS
-- =============================================

CREATE OR REPLACE FUNCTION public.cleanup_guest_cart_snapshots()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_deleted_count integer;
BEGIN
  -- Delete snapshots older than 30 days
  DELETE FROM public.guest_cart_snapshots 
  WHERE updated_at < now() - interval '30 days';
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'cleanup_at', now()
  );
END;
$$;