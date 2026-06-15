ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS failure_reason text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS failure_code text;
GRANT SELECT (failure_reason, failure_code) ON public.payments TO authenticated;