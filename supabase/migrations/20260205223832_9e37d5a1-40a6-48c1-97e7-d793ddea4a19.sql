-- Add relevance filtering columns to home_sections (used by Admin Portal Home Curation)
ALTER TABLE public.home_sections
ADD COLUMN IF NOT EXISTS include_keywords TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS exclude_keywords TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS strict BOOLEAN DEFAULT true;

-- Populate with filtering rules for each section
UPDATE public.home_sections SET
  include_keywords = ARRAY['iphone','samsung','galaxy','pixel','unlocked','smartphone','android','5g'],
  exclude_keywords = ARRAY['case','cover','screen protector','charger','parts','repair','lot','lcd','holder','stand','mount','tempered','cable','adapter'],
  strict = true
WHERE key = 'phones';

UPDATE public.home_sections SET
  include_keywords = ARRAY['ps5','playstation','xbox','nintendo','switch','console','game','controller','gaming'],
  exclude_keywords = ARRAY['repair','tool','kit','screwdriver','shell','housing','replacement','mod','parts','flex cable','thumbstick'],
  strict = true
WHERE key = 'gaming';

UPDATE public.home_sections SET
  include_keywords = ARRAY['laptop','macbook','thinkpad','dell','hp','lenovo','surface','notebook','chromebook','desktop','pc','computer'],
  exclude_keywords = ARRAY['case','sleeve','skin','sticker','decal','bag','cover','stand','mousepad','charger','adapter','dock','hub','keyboard cover'],
  strict = true
WHERE key = 'computers';

UPDATE public.home_sections SET
  include_keywords = ARRAY['toyota','honda','ford','bmw','mercedes','chevy','chevrolet','nissan','truck','suv','sedan','car'],
  exclude_keywords = ARRAY['seat cover','floor mat','sticker','decal','hook','organizer','trim','parts','accessories','emblem','badge','keychain','air freshener','phone holder'],
  strict = true
WHERE key = 'vehicles';

UPDATE public.home_sections SET
  include_keywords = ARRAY['shoes','sneakers','nike','adidas','jordan','dress','shirt','jacket','pants','jeans','clothing'],
  exclude_keywords = ARRAY['laces','insole','cleaner','protector','spray','brush','polish','tree','stretcher','storage'],
  strict = true
WHERE key = 'clothing';

UPDATE public.home_sections SET
  include_keywords = ARRAY['furniture','sofa','table','chair','lamp','decor','garden','patio','outdoor'],
  exclude_keywords = ARRAY['cover','protector','cleaner','spray','polish','replacement','parts'],
  strict = true
WHERE key = 'home_garden';

UPDATE public.home_sections SET
  include_keywords = ARRAY['refurbished','renewed','certified','like new'],
  exclude_keywords = ARRAY['parts','repair','broken','for parts','as is'],
  strict = true
WHERE key = 'refurbished';

UPDATE public.home_sections SET
  include_keywords = ARRAY['parts','accessories','replacement','oem','aftermarket'],
  exclude_keywords = ARRAY[]::TEXT[],
  strict = false
WHERE key = 'parts_accessories';