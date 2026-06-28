GRANT SELECT ON public.payments TO authenticated;
GRANT SELECT ON public.payments TO anon;

REVOKE SELECT (raw_request, raw_events) ON public.payments FROM authenticated;
REVOKE SELECT (raw_request, raw_events) ON public.payments FROM anon;
REVOKE SELECT (raw_request, raw_events) ON public.payments FROM PUBLIC;