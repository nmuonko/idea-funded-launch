-- Fix: Revoke public RPC access to finalize_paid_order
-- This function should ONLY be called from edge functions using service_role key
REVOKE EXECUTE ON FUNCTION public.finalize_paid_order(uuid, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_paid_order(uuid, text, text, text) FROM authenticated;