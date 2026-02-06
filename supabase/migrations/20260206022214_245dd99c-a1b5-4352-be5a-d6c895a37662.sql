-- Create catalog_filter_profiles table for production stabilization
-- These profiles map mobile category keys to include/exclude keywords

CREATE TABLE IF NOT EXISTS public.catalog_filter_profiles (
  key TEXT PRIMARY KEY,
  include_keywords TEXT[] NOT NULL DEFAULT '{}',
  exclude_hard TEXT[] NOT NULL DEFAULT '{}',
  exclude_soft TEXT[] NOT NULL DEFAULT '{}',
  mode TEXT NOT NULL DEFAULT 'general' CHECK (mode IN ('general', 'vehicle')),
  min_price_usd NUMERIC DEFAULT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_catalog_filter_profiles_key ON public.catalog_filter_profiles (key);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION public.update_catalog_filter_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_catalog_filter_profiles_updated_at ON public.catalog_filter_profiles;
CREATE TRIGGER update_catalog_filter_profiles_updated_at
  BEFORE UPDATE ON public.catalog_filter_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_catalog_filter_profiles_updated_at();

-- Seed default profiles for mobile compatibility
INSERT INTO public.catalog_filter_profiles (key, include_keywords, exclude_hard, exclude_soft, mode, min_price_usd)
VALUES
  ('electronics', 
   ARRAY['iphone','samsung','galaxy','pixel','laptop','macbook','headphones','airpods','ps5','xbox','nintendo','tablet','ipad']::TEXT[],
   ARRAY['case','cover','screen protector','tempered','digitizer','lcd','housing','frame','repair','parts','lot','bulk']::TEXT[],
   ARRAY['holder','stand','mount','cable','adapter']::TEXT[],
   'general', 25),
  
  ('phones',
   ARRAY['iphone','samsung','galaxy','pixel','unlocked','smartphone','android','5g']::TEXT[],
   ARRAY['case','cover','screen protector','tempered','digitizer','lcd','housing','frame','repair','parts','lot','bulk','charger only']::TEXT[],
   ARRAY['holder','stand','mount','cable']::TEXT[],
   'general', 50),
  
  ('tablets',
   ARRAY['ipad','tablet','surface','galaxy tab','kindle fire']::TEXT[],
   ARRAY['case','cover','screen protector','keyboard','stylus','stand']::TEXT[],
   ARRAY['charger','cable']::TEXT[],
   'general', 80),
  
  ('monitors',
   ARRAY['monitor','display','screen','4k','curved','gaming monitor','ultrawide']::TEXT[],
   ARRAY['mount','arm','stand','cable','cover']::TEXT[],
   ARRAY[]::TEXT[],
   'general', 100),
  
  ('audio',
   ARRAY['airpods','earbuds','headphones','bluetooth speaker','beats','bose','jbl','soundbar']::TEXT[],
   ARRAY['case','cover','replacement part','repair','ear tips','cushion']::TEXT[],
   ARRAY['cable','adapter']::TEXT[],
   'general', 20),
  
  ('computers',
   ARRAY['laptop','macbook','thinkpad','dell','hp','lenovo','surface','notebook','desktop','pc','computer']::TEXT[],
   ARRAY['sleeve','sticker','decal','skin','keyboard cover','trackpad protector','vinyl','bag only']::TEXT[],
   ARRAY['stand','mousepad','hub','dock']::TEXT[],
   'general', 150),
  
  ('gaming',
   ARRAY['ps5','playstation','xbox','nintendo','switch','console','gaming','controller']::TEXT[],
   ARRAY['repair','screwdriver','tool kit','replacement part','shell','housing','mod chip','flex cable']::TEXT[],
   ARRAY['controller skin','thumb grip','charging dock']::TEXT[],
   'general', 30),
  
  ('vehicles',
   ARRAY['toyota','honda','ford','bmw','mercedes','nissan','chevrolet','hyundai','kia','volkswagen','rav4','camry','civic','accord','f150','silverado']::TEXT[],
   ARRAY['seat cover','floor mat','steering wheel cover','sticker','decal','hook','organizer','trim','emblem','badge','keychain','air freshener','tissue box','phone holder','cup holder','visor','sunshade','cargo liner','dash cover','headrest','cushion','protector','accessory kit','parts only','wheels','tires','brake']::TEXT[],
   ARRAY[]::TEXT[],
   'vehicle', 1500),
  
  ('parts_accessories',
   ARRAY['carplay','android auto','car stereo','dash cam','jump starter','headlights','led','tire','rim','battery','brake pad','oil filter','spark plug']::TEXT[],
   ARRAY['sticker','decal','air freshener']::TEXT[],
   ARRAY[]::TEXT[],
   'general', 10),
  
  ('clothing_shoes_accessories',
   ARRAY['nike','adidas','jordan','sneakers','shoes','hoodie','jacket','dress','handbag','boots','converse','puma','new balance']::TEXT[],
   ARRAY['laces only','replacement','insole','cleaner','protector spray']::TEXT[],
   ARRAY['storage','organizer']::TEXT[],
   'general', 15),
  
  ('home_garden',
   ARRAY['furniture','sofa','table','chair','lamp','decor','garden','patio','outdoor','kitchen','vacuum','blender']::TEXT[],
   ARRAY['replacement part','repair kit','cover only']::TEXT[],
   ARRAY['cleaner','polish','spray']::TEXT[],
   'general', 20),
  
  ('toys',
   ARRAY['lego','toy','rc car','drone','board game','puzzle','action figure','doll','kids']::TEXT[],
   ARRAY['parts','replacement','repair']::TEXT[],
   ARRAY[]::TEXT[],
   'general', 10),
  
  ('sporting_goods',
   ARRAY['dumbbells','soccer','basketball','yoga','fitness','treadmill','bike','running','golf','tennis']::TEXT[],
   ARRAY['replacement','repair','parts']::TEXT[],
   ARRAY[]::TEXT[],
   'general', 15),
  
  ('jewelry_watches',
   ARRAY['watch','rolex','omega','necklace','ring','bracelet','earrings','gold','silver','diamond']::TEXT[],
   ARRAY['box','pouch','repair','tool']::TEXT[],
   ARRAY['cleaner','polishing']::TEXT[],
   'general', 25),
  
  ('refurbished',
   ARRAY['refurbished','renewed','certified','like new']::TEXT[],
   ARRAY['for parts','as is','broken','not working','parts only']::TEXT[],
   ARRAY[]::TEXT[],
   'general', 50),
  
  ('business_industrial',
   ARRAY['generator','air compressor','forklift','commercial','industrial','tools','equipment']::TEXT[],
   ARRAY['parts','manual']::TEXT[],
   ARRAY[]::TEXT[],
   'general', 50),
  
  ('all',
   ARRAY[]::TEXT[],
   ARRAY['kindle','audible','ebook','e-book','paperback','hardcover','magazine','subscription']::TEXT[],
   ARRAY[]::TEXT[],
   'general', NULL),
  
  ('electronics_trending',
   ARRAY['iphone','samsung','laptop','headphones','airpods','ps5']::TEXT[],
   ARRAY['case','cover','screen protector','repair','parts']::TEXT[],
   ARRAY[]::TEXT[],
   'general', 25),
  
  ('phones_trending',
   ARRAY['iphone','samsung','galaxy','pixel','smartphone']::TEXT[],
   ARRAY['case','cover','screen protector','repair']::TEXT[],
   ARRAY[]::TEXT[],
   'general', 50),
  
  ('vehicles_all',
   ARRAY['toyota','honda','ford','bmw','mercedes','car','truck','suv']::TEXT[],
   ARRAY['seat cover','floor mat','parts','accessory','wheels','tires']::TEXT[],
   ARRAY[]::TEXT[],
   'vehicle', 1500),
  
  ('vehicles_cars_trucks',
   ARRAY['car','truck','sedan','suv','pickup','coupe']::TEXT[],
   ARRAY['seat cover','floor mat','parts','accessory']::TEXT[],
   ARRAY[]::TEXT[],
   'vehicle', 2000),
  
  ('vehicles_motorcycles',
   ARRAY['motorcycle','harley','honda','yamaha','kawasaki','suzuki']::TEXT[],
   ARRAY['helmet','jacket','gloves','parts','accessory']::TEXT[],
   ARRAY[]::TEXT[],
   'vehicle', 800)
ON CONFLICT (key) DO UPDATE SET
  include_keywords = EXCLUDED.include_keywords,
  exclude_hard = EXCLUDED.exclude_hard,
  exclude_soft = EXCLUDED.exclude_soft,
  mode = EXCLUDED.mode,
  min_price_usd = EXCLUDED.min_price_usd,
  updated_at = now();

-- Enable RLS
ALTER TABLE public.catalog_filter_profiles ENABLE ROW LEVEL SECURITY;

-- Allow public read access
DROP POLICY IF EXISTS "Allow public read access to filter profiles" ON public.catalog_filter_profiles;
CREATE POLICY "Allow public read access to filter profiles"
  ON public.catalog_filter_profiles
  FOR SELECT
  USING (true);

-- Allow service role to manage
DROP POLICY IF EXISTS "Allow service role full access to filter profiles" ON public.catalog_filter_profiles;
CREATE POLICY "Allow service role full access to filter profiles"
  ON public.catalog_filter_profiles
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.catalog_filter_profiles IS 'Filter profiles for catalog categories - maps mobile keys to include/exclude keywords';