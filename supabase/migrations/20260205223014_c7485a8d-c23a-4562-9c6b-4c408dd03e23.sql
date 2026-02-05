-- Add filtering columns to catalog_sections for relevance filtering
ALTER TABLE public.catalog_sections 
ADD COLUMN IF NOT EXISTS include_keywords TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS exclude_keywords TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS min_price_usd NUMERIC DEFAULT NULL,
ADD COLUMN IF NOT EXISTS strict BOOLEAN DEFAULT true;

-- phones: actual phones only
UPDATE public.catalog_sections SET
  include_keywords = ARRAY['iphone','samsung','galaxy','pixel','smartphone','unlocked','android','5g','pro max','ultra'],
  exclude_keywords = ARRAY['case','cover','screen protector','tempered','charger','cable','parts','repair','lcd','digitizer','housing','frame','back glass','lot','bulk','battery','replacement','holder','stand','mount','strap','band','pouch','wallet'],
  min_price_usd = 50,
  strict = true
WHERE key = 'phones';

-- video_games: consoles and games only
UPDATE public.catalog_sections SET
  include_keywords = ARRAY['ps5','playstation 5','xbox series','nintendo switch','console','game','controller','gaming'],
  exclude_keywords = ARRAY['repair','tool','kit','screwdriver','shell','housing','replacement','mod','thumbstick','joystick','charging port','parts','flex cable','ribbon','sticker','decal','skin','cover','case','bag'],
  min_price_usd = 20,
  strict = true
WHERE key = 'video_games';

-- computers: laptops/desktops only
UPDATE public.catalog_sections SET
  include_keywords = ARRAY['laptop','macbook','thinkpad','dell','hp','lenovo','surface','notebook','chromebook','desktop','pc','computer','workstation'],
  exclude_keywords = ARRAY['case','sleeve','skin','sticker','decal','bag','cover','keyboard cover','trackpad','stand','mousepad','vinyl','protector','screen protector','holder','dock','hub','charger','adapter','cable','pouch','strap'],
  min_price_usd = 100,
  strict = true
WHERE key = 'computers';

-- vehicles: real vehicles only (most strict)
UPDATE public.catalog_sections SET
  include_keywords = ARRAY['toyota','honda','ford','bmw','mercedes','chevy','chevrolet','nissan','hyundai','kia','volkswagen','audi','lexus','mazda','subaru','jeep','dodge','truck','suv','sedan'],
  exclude_keywords = ARRAY['seat cover','steering wheel cover','sticker','decal','hook','organizer','trim','handle cover','floor mat','parts','accessories','kit','emblem','badge','keychain','air freshener','phone holder','cup holder','tissue box','visor','sunshade','cover','mat','protector','cargo','liner','headrest','cushion'],
  min_price_usd = 1000,
  strict = true
WHERE key = 'vehicles';

-- fashion: actual clothing/shoes
UPDATE public.catalog_sections SET
  include_keywords = ARRAY['shoes','sneakers','boots','nike','adidas','jordan','puma','new balance','dress','shirt','jacket','pants','jeans','hoodie','sweater'],
  exclude_keywords = ARRAY['laces','insole','cleaner','protector','crease','shield','storage','organizer','spray','brush','polish','tree','stretcher','horn','rack','box','display'],
  min_price_usd = 15,
  strict = true
WHERE key = 'fashion';