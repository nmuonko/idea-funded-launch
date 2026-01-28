-- Add new columns to catalog_providers for fully backend-driven provider system
ALTER TABLE public.catalog_providers 
ADD COLUMN IF NOT EXISTS logo_url text NULL,
ADD COLUMN IF NOT EXISTS color_hex text NULL DEFAULT '#3B82F6',
ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{"home":true,"search":true,"product":true,"offers":true}'::jsonb,
ADD COLUMN IF NOT EXISTS requires_keys jsonb NOT NULL DEFAULT '{}'::jsonb,
ADD COLUMN IF NOT EXISTS adapter_name text NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.catalog_providers.capabilities IS 'Provider capabilities: home, search, product, offers';
COMMENT ON COLUMN public.catalog_providers.requires_keys IS 'Required secret keys for this provider, e.g. {"apiKeySecret":"RAINFOREST_API_KEY"}';
COMMENT ON COLUMN public.catalog_providers.logo_url IS 'Provider logo URL for display in mobile app';
COMMENT ON COLUMN public.catalog_providers.color_hex IS 'Brand color hex for UI theming';
COMMENT ON COLUMN public.catalog_providers.adapter_name IS 'Internal adapter name if different from provider name';

-- Update existing Amazon provider with proper capabilities
UPDATE public.catalog_providers 
SET 
  capabilities = '{"home":true,"search":true,"product":true,"offers":true}'::jsonb,
  requires_keys = '{"apiKeySecret":"RAINFOREST_API_KEY"}'::jsonb,
  adapter_name = 'rainforest',
  color_hex = '#FF9900',
  logo_url = 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg'
WHERE name = 'amazon';

-- Create index for efficient provider lookup
CREATE INDEX IF NOT EXISTS idx_catalog_providers_enabled_priority 
ON public.catalog_providers(enabled, priority DESC) 
WHERE enabled = true;

-- Ensure RLS policies allow authenticated read access
DROP POLICY IF EXISTS "Authenticated users can read enabled providers" ON public.catalog_providers;
CREATE POLICY "Authenticated users can read enabled providers" 
ON public.catalog_providers 
FOR SELECT 
USING (true);

DROP POLICY IF EXISTS "Admins can manage providers" ON public.catalog_providers;
CREATE POLICY "Admins can manage providers" 
ON public.catalog_providers 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));