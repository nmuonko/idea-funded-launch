-- App Runtime Config table for backend-controlled UI + providers
-- Single source of truth for mobile app configuration

CREATE TABLE public.app_runtime_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  env text NOT NULL CHECK (env IN ('production', 'staging')),
  version bigint NOT NULL DEFAULT (EXTRACT(EPOCH FROM now()) * 1000)::bigint,
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- UI configuration: categories, menu, sections, layout rules
  ui jsonb NOT NULL DEFAULT '{
    "drawer": [
      { "key": "home", "label_fr": "Accueil", "label_en": "Home", "type": "route", "route": "Home" },
      { "key": "electronics", "label_fr": "Électronique", "label_en": "Electronics", "type": "collection", "collectionKey": "electronics" },
      { "key": "phones", "label_fr": "Téléphones", "label_en": "Phones", "type": "collection", "collectionKey": "phones" },
      { "key": "computers", "label_fr": "Ordinateurs", "label_en": "Computers", "type": "collection", "collectionKey": "computers" },
      { "key": "vehicles", "label_fr": "Véhicules", "label_en": "Vehicles", "type": "collection", "collectionKey": "vehicles" }
    ],
    "chips": [
      { "key": "all", "label_fr": "Tout", "label_en": "All", "collectionKey": "electronics_trending" },
      { "key": "phones", "label_fr": "Téléphones", "label_en": "Phones", "collectionKey": "phones" },
      { "key": "tablets", "label_fr": "Tablettes", "label_en": "Tablets", "collectionKey": "tablets" },
      { "key": "monitors", "label_fr": "Moniteurs", "label_en": "Monitors", "collectionKey": "monitors" },
      { "key": "computers", "label_fr": "Ordinateurs", "label_en": "Computers", "collectionKey": "computers" },
      { "key": "vehicles", "label_fr": "Véhicules", "label_en": "Vehicles", "collectionKey": "vehicles" }
    ]
  }'::jsonb,
  
  -- Provider definitions (rainforest, ebay, etc.)
  providers jsonb NOT NULL DEFAULT '[
    { "key": "rainforest", "label": "Amazon", "enabled": true, "type": "amazon", "priority": 1 },
    { "key": "ebay", "label": "eBay", "enabled": false, "type": "ebay", "priority": 2 }
  ]'::jsonb,
  
  -- Search configuration: language rules, strict rules, cache TTL, db/live strategy
  search jsonb NOT NULL DEFAULT '{
    "defaultMode": "db",
    "autoTranslateFrToEn": true,
    "strictRules": [
      { "match": "iphone", "include": ["iphone"], "exclude": ["case", "cover", "charger", "protector", "kindle", "book", "prime video", "subscription"] }
    ],
    "cache": {
      "searchTtlMinutes": 720,
      "itemTtlMinutes": 2880,
      "negativeTtlSeconds": 120
    }
  }'::jsonb,
  
  -- Home configuration: curated queries/collections for home screen
  home jsonb NOT NULL DEFAULT '{
    "sections": [
      { "key": "trending", "label_fr": "Tendances", "label_en": "Trending", "collectionKey": "electronics_trending", "maxItems": 10 },
      { "key": "best", "label_fr": "Meilleures ventes", "label_en": "Best Sellers", "collectionKey": "best_sellers_electronics", "maxItems": 10 },
      { "key": "deals", "label_fr": "Promos", "label_en": "Deals", "collectionKey": "deals_electronics", "maxItems": 10 }
    ],
    "collections": {
      "electronics_trending": { "queries": ["iphone", "samsung phone", "laptop", "headphones", "monitor"], "providers": ["rainforest"], "dbOnly": true },
      "phones": { "queries": ["iphone", "android phone", "unlocked smartphone"], "providers": ["rainforest", "ebay"], "dbOnly": true },
      "tablets": { "queries": ["ipad", "samsung tablet", "android tablet"], "providers": ["rainforest"], "dbOnly": true },
      "monitors": { "queries": ["gaming monitor", "4k monitor", "ultrawide monitor"], "providers": ["rainforest"], "dbOnly": true },
      "computers": { "queries": ["laptop", "macbook", "gaming laptop", "desktop computer"], "providers": ["rainforest"], "dbOnly": true },
      "vehicles": { "queries": ["tesla accessories", "car accessories", "car charger"], "providers": ["rainforest"], "dbOnly": true },
      "best_sellers_electronics": { "queries": ["best selling electronics", "top rated headphones", "popular laptop"], "providers": ["rainforest"], "dbOnly": true },
      "deals_electronics": { "queries": ["electronics deals", "phone deals", "laptop sale"], "providers": ["rainforest"], "dbOnly": true }
    }
  }'::jsonb,
  
  -- Blocks configuration: denylist keywords/categories (books/prime video/subscriptions)
  blocks jsonb NOT NULL DEFAULT '{
    "denyKeywords": ["kindle", "audible", "prime video", "subscription", "ebook", "e-book", "paperback", "hardcover", "book", "magazine", "manga", "comics", "audiobook", "novel", "textbook", "membership", "streaming", "unlimited"],
    "denyUrlContains": ["/gp/video", "/Prime-Video", "/kindle", "/audible", "/books", "/magazines"],
    "denyCategories": ["Books", "Kindle Store", "Audible Books & Originals", "Prime Video", "Digital Music", "Magazine Subscriptions", "Apps & Games", "Subscriptions"]
  }'::jsonb,
  
  CONSTRAINT unique_env UNIQUE (env)
);

-- Enable RLS
ALTER TABLE public.app_runtime_config ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Admins can manage runtime config"
  ON public.app_runtime_config
  FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anyone can read runtime config"
  ON public.app_runtime_config
  FOR SELECT
  USING (true);

-- Trigger to auto-update version on changes
CREATE OR REPLACE FUNCTION update_runtime_config_version()
RETURNS TRIGGER AS $$
BEGIN
  NEW.version := (EXTRACT(EPOCH FROM now()) * 1000)::bigint;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_runtime_config_version
  BEFORE UPDATE ON public.app_runtime_config
  FOR EACH ROW
  EXECUTE FUNCTION update_runtime_config_version();

-- Seed production and staging rows
INSERT INTO public.app_runtime_config (env) VALUES ('production');
INSERT INTO public.app_runtime_config (env) VALUES ('staging');