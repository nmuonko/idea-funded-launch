
-- 1. Register shopify as a catalog provider
INSERT INTO public.catalog_providers (name, display_name, enabled, priority, environment, adapter_name, capabilities)
VALUES ('shopify', 'Shopify', true, 50, 'all', 'shopify', '{"search": true, "categories": true, "inventory": true}'::jsonb)
ON CONFLICT (name) DO UPDATE SET enabled = true, display_name = EXCLUDED.display_name;

-- 2. Collections
CREATE TABLE IF NOT EXISTS public.shopify_collections (
  id text PRIMARY KEY,
  handle text NOT NULL,
  title text NOT NULL,
  description text,
  image_url text,
  product_ids text[] DEFAULT '{}',
  updated_at_shopify timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shopify_collections_handle ON public.shopify_collections(handle);
ALTER TABLE public.shopify_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages shopify_collections" ON public.shopify_collections
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 3. Inventory levels
CREATE TABLE IF NOT EXISTS public.shopify_inventory_levels (
  inventory_item_id text NOT NULL,
  location_id text NOT NULL,
  available integer NOT NULL DEFAULT 0,
  variant_id text,
  product_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (inventory_item_id, location_id)
);
CREATE INDEX IF NOT EXISTS idx_shopify_inv_variant ON public.shopify_inventory_levels(variant_id);
CREATE INDEX IF NOT EXISTS idx_shopify_inv_product ON public.shopify_inventory_levels(product_id);
ALTER TABLE public.shopify_inventory_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages shopify_inventory" ON public.shopify_inventory_levels
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- 4. Webhook log
CREATE TABLE IF NOT EXISTS public.shopify_webhook_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  shop_domain text,
  payload jsonb NOT NULL,
  hmac_valid boolean,
  processed boolean NOT NULL DEFAULT false,
  error text,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_shopify_webhook_topic ON public.shopify_webhook_log(topic, received_at DESC);
ALTER TABLE public.shopify_webhook_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages shopify_webhook_log" ON public.shopify_webhook_log
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
