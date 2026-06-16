REVOKE SELECT (secret_refs) ON public.payment_providers FROM authenticated;
REVOKE SELECT (secret_refs) ON public.payment_providers FROM anon;