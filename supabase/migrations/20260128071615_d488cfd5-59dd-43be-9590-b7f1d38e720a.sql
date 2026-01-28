-- Create provider_tokens table for OAuth token caching
CREATE TABLE IF NOT EXISTS public.provider_tokens (
  provider text PRIMARY KEY,
  access_token text NOT NULL,
  token_type text DEFAULT 'Bearer',
  expires_at timestamptz NOT NULL,
  scopes text[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.provider_tokens ENABLE ROW LEVEL SECURITY;

-- Only service role can access tokens (edge functions)
CREATE POLICY "Service role only for provider_tokens"
  ON public.provider_tokens
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- Add eBay to catalog_providers
INSERT INTO public.catalog_providers (
  name, 
  display_name, 
  enabled, 
  priority, 
  capabilities, 
  secret_key_name,
  adapter_name,
  config
) VALUES (
  'ebay',
  'eBay',
  true,
  20,
  '{"home": true, "search": true, "product": true, "offers": false}'::jsonb,
  'EBAY_CLIENT_ID',
  'ebay',
  '{"environment": "production", "marketplace": "EBAY_US", "searchLimit": 20}'::jsonb
) ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  capabilities = EXCLUDED.capabilities,
  secret_key_name = EXCLUDED.secret_key_name,
  adapter_name = EXCLUDED.adapter_name,
  config = EXCLUDED.config,
  updated_at = now();

-- Update trigger for provider_tokens
CREATE OR REPLACE FUNCTION public.update_provider_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_update_provider_tokens_updated_at
  BEFORE UPDATE ON public.provider_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_provider_tokens_updated_at();