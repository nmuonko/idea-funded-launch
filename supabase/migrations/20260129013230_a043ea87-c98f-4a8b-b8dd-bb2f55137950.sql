-- Create catalog_categories table for backend-driven tab definitions
CREATE TABLE IF NOT EXISTS public.catalog_categories (
  slug text PRIMARY KEY,
  title text NOT NULL,
  group_title text NOT NULL DEFAULT 'Browse',
  icon text,
  priority int NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  provider_scope text NOT NULL DEFAULT 'all', -- 'all', 'ebay', 'rainforest'
  queries jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.catalog_categories ENABLE ROW LEVEL SECURITY;

-- Allow public read access (categories are public data)
CREATE POLICY "Anyone can read catalog_categories"
  ON public.catalog_categories FOR SELECT
  USING (true);

-- Allow admins to manage categories
CREATE POLICY "Admins can manage catalog_categories"
  ON public.catalog_categories FOR ALL
  USING (public.is_admin());

-- Create index for ordering
CREATE INDEX IF NOT EXISTS idx_catalog_categories_priority ON public.catalog_categories(priority ASC);
CREATE INDEX IF NOT EXISTS idx_catalog_categories_enabled ON public.catalog_categories(enabled) WHERE enabled = true;

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_catalog_categories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS update_catalog_categories_updated_at ON public.catalog_categories;
CREATE TRIGGER update_catalog_categories_updated_at
  BEFORE UPDATE ON public.catalog_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_catalog_categories_updated_at();

-- Seed the categories in the exact order specified (excluding eBay Live, Saved, Collectibles)
INSERT INTO public.catalog_categories (slug, title, group_title, icon, priority, enabled, provider_scope, queries) VALUES
('motors', 'Motors', 'Browse', 'car', 1, true, 'ebay', '{
  "ebay": {
    "q": "car OR truck OR motorcycle OR vehicle",
    "filters": {"buyingOptions": "FIXED_PRICE"},
    "denyKeywords": ["floor mats", "wheels", "tires", "rim", "seat cover", "car cover", "snow chains", "accessory", "parts", "replacement", "tool", "charger", "adapter"],
    "allowKeywords": ["car", "truck", "suv", "sedan", "coupe", "van", "pickup", "vehicle", "motorcycle"],
    "minPriceUsd": 1500,
    "ttlSeconds": 1800
  },
  "rainforest": {
    "enabled": false
  }
}'::jsonb),

('electronics', 'Electronics', 'Browse', 'smartphone', 2, true, 'all', '{
  "ebay": {
    "q": "iphone OR samsung phone OR laptop OR headphones OR monitor OR ipad OR tablet OR macbook OR gaming pc",
    "ttlSeconds": 3600
  },
  "rainforest": {
    "q": "iphone OR samsung phone OR laptop OR headphones OR monitor OR ipad OR tablet",
    "dbOnly": true,
    "ttlSeconds": 86400
  }
}'::jsonb),

('home_garden', 'Home & Garden', 'Browse', 'home', 3, true, 'all', '{
  "ebay": {
    "q": "home decor OR kitchen appliance OR furniture OR bedding OR garden tools",
    "ttlSeconds": 3600
  },
  "rainforest": {
    "q": "home decor OR kitchen appliance OR furniture OR bedding",
    "dbOnly": true,
    "ttlSeconds": 86400
  }
}'::jsonb),

('clothing', 'Clothing, Shoes & Accessories', 'Browse', 'shirt', 4, true, 'all', '{
  "ebay": {
    "q": "sneakers OR men clothing OR women clothing OR jacket OR dress OR shoes",
    "ttlSeconds": 3600
  },
  "rainforest": {
    "q": "sneakers OR men clothing OR women clothing OR jacket OR dress",
    "dbOnly": true,
    "ttlSeconds": 86400
  }
}'::jsonb),

('toys', 'Toys', 'Browse', 'gamepad', 5, true, 'all', '{
  "ebay": {
    "q": "lego OR toy OR kids toy OR puzzle OR action figure OR board game",
    "ttlSeconds": 3600
  },
  "rainforest": {
    "q": "lego OR toy OR kids toy OR puzzle OR action figure",
    "dbOnly": true,
    "ttlSeconds": 86400
  }
}'::jsonb),

('sporting_goods', 'Sporting Goods', 'Browse', 'dumbbell', 6, true, 'all', '{
  "ebay": {
    "q": "sports equipment OR basketball OR soccer OR gym OR fitness OR camping",
    "ttlSeconds": 3600
  },
  "rainforest": {
    "q": "sports equipment OR basketball OR soccer OR gym OR fitness",
    "dbOnly": true,
    "ttlSeconds": 86400
  }
}'::jsonb),

('business_industrial', 'Business & Industrial', 'Browse', 'building', 7, true, 'all', '{
  "ebay": {
    "q": "industrial equipment OR tools OR office equipment OR commercial",
    "ttlSeconds": 3600
  },
  "rainforest": {
    "q": "industrial equipment OR tools OR office equipment",
    "dbOnly": true,
    "ttlSeconds": 86400
  }
}'::jsonb),

('jewelry_watches', 'Jewelry & Watches', 'Browse', 'watch', 8, true, 'all', '{
  "ebay": {
    "q": "watch OR jewelry OR necklace OR ring OR bracelet OR earrings",
    "ttlSeconds": 3600
  },
  "rainforest": {
    "q": "watch OR jewelry OR necklace OR ring OR bracelet",
    "dbOnly": true,
    "ttlSeconds": 86400
  }
}'::jsonb),

('refurbished', 'Refurbished', 'Browse', 'recycle', 9, true, 'all', '{
  "ebay": {
    "q": "refurbished iphone OR renewed laptop OR refurbished electronics OR certified refurbished",
    "ttlSeconds": 3600
  },
  "rainforest": {
    "q": "refurbished iphone OR renewed laptop OR refurbished electronics",
    "dbOnly": true,
    "ttlSeconds": 86400
  }
}'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  group_title = EXCLUDED.group_title,
  icon = EXCLUDED.icon,
  priority = EXCLUDED.priority,
  provider_scope = EXCLUDED.provider_scope,
  queries = EXCLUDED.queries,
  updated_at = now();