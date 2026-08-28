ALTER TABLE public.international_products
  ADD COLUMN IF NOT EXISTS is_final_price boolean NOT NULL DEFAULT false;

INSERT INTO public.app_secrets (key, value)
VALUES ('turkey_upload_token', jsonb_build_object('hash', '9361b6e43585de032c251357a3efb401d1a3bc487325a64087c914533f3dd821'))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

UPDATE public.international_products SET is_active = false, updated_at = now() WHERE is_active = true;