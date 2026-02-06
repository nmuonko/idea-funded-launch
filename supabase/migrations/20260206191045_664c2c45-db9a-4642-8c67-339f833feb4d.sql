-- Add missing home_sections for mobile categories that don't exist yet
-- Current sections: phones(0), vehicles(1), gaming(2), computers(3), clothing(4), home_garden(5), refurbished(6), parts_accessories(7)
-- Missing from sectionProfiles.ts: electronics, toys, sporting_goods

-- Add electronics section (computers seeds will be usable here too)
INSERT INTO home_sections (key, title_en, title_fr, enabled, sort_order, default_category_key, ebay_category, is_vehicle, min_price)
VALUES 
  ('electronics', 'Electronics', 'Électronique', true, 1, null, null, false, 0),
  ('toys', 'Toys', 'Jouets', true, 8, null, null, false, 0),
  ('sporting_goods', 'Sporting Goods', 'Articles de Sport', true, 9, null, null, false, 0)
ON CONFLICT (key) DO NOTHING;

-- Add starter seeds for electronics
INSERT INTO home_section_seeds (section_key, query, enabled, weight) VALUES
  ('electronics', 'wireless headphones bluetooth', true, 100),
  ('electronics', 'laptop computer deals', true, 100),
  ('electronics', 'tablet android ipad', true, 100),
  ('electronics', 'smart tv 4k', true, 100),
  ('electronics', 'bluetooth speaker portable', true, 100),
  ('electronics', 'airpods earbuds wireless', true, 100),
  ('electronics', 'camera digital mirrorless', true, 100),
  ('electronics', 'monitor gaming 27 inch', true, 100),
  ('electronics', 'usb c charger fast', true, 100),
  ('electronics', 'smart watch fitness tracker', true, 100),
  ('electronics', 'power bank portable charger', true, 100),
  ('electronics', 'drone camera 4k', true, 100)
ON CONFLICT DO NOTHING;

-- Add starter seeds for clothing (section exists but has no seeds)
INSERT INTO home_section_seeds (section_key, query, enabled, weight) VALUES
  ('clothing', 'nike shoes sneakers', true, 100),
  ('clothing', 'adidas running shoes', true, 100),
  ('clothing', 'jordan retro sneakers', true, 100),
  ('clothing', 'mens hoodie streetwear', true, 100),
  ('clothing', 'womens dress casual', true, 100),
  ('clothing', 'jeans mens slim fit', true, 100),
  ('clothing', 'winter jacket waterproof', true, 100),
  ('clothing', 'sneakers mens fashion', true, 100),
  ('clothing', 'backpack school travel', true, 100),
  ('clothing', 'sunglasses designer', true, 100)
ON CONFLICT DO NOTHING;

-- Add starter seeds for home_garden (section exists but has no seeds)
INSERT INTO home_section_seeds (section_key, query, enabled, weight) VALUES
  ('home_garden', 'sofa living room modern', true, 100),
  ('home_garden', 'kitchen appliances small', true, 100),
  ('home_garden', 'vacuum cleaner cordless', true, 100),
  ('home_garden', 'air fryer large family', true, 100),
  ('home_garden', 'bed frame queen king', true, 100),
  ('home_garden', 'coffee maker espresso', true, 100),
  ('home_garden', 'garden tools set', true, 100),
  ('home_garden', 'led light bulbs smart', true, 100),
  ('home_garden', 'dining table chairs set', true, 100),
  ('home_garden', 'storage organizer home', true, 100)
ON CONFLICT DO NOTHING;

-- Add starter seeds for refurbished (section exists but has no seeds)
INSERT INTO home_section_seeds (section_key, query, enabled, weight) VALUES
  ('refurbished', 'refurbished iphone unlocked', true, 100),
  ('refurbished', 'refurbished laptop deals', true, 100),
  ('refurbished', 'refurbished ipad tablet', true, 100),
  ('refurbished', 'renewed electronics deals', true, 100),
  ('refurbished', 'refurbished samsung galaxy', true, 100),
  ('refurbished', 'refurbished macbook pro', true, 100),
  ('refurbished', 'refurbished gaming console', true, 100),
  ('refurbished', 'certified refurbished headphones', true, 100),
  ('refurbished', 'refurbished smartwatch', true, 100),
  ('refurbished', 'open box electronics', true, 100)
ON CONFLICT DO NOTHING;

-- Add starter seeds for parts_accessories (section exists but has no seeds)
INSERT INTO home_section_seeds (section_key, query, enabled, weight) VALUES
  ('parts_accessories', 'phone case protective', true, 100),
  ('parts_accessories', 'screen protector tempered glass', true, 100),
  ('parts_accessories', 'car phone mount holder', true, 100),
  ('parts_accessories', 'car stereo carplay android', true, 100),
  ('parts_accessories', 'obd2 scanner diagnostic', true, 100),
  ('parts_accessories', 'car led headlight bulbs', true, 100),
  ('parts_accessories', 'dashcam front rear', true, 100),
  ('parts_accessories', 'car seat cover leather', true, 100),
  ('parts_accessories', 'wireless car charger mount', true, 100),
  ('parts_accessories', 'car jump starter portable', true, 100)
ON CONFLICT DO NOTHING;

-- Add starter seeds for toys
INSERT INTO home_section_seeds (section_key, query, enabled, weight) VALUES
  ('toys', 'lego sets building', true, 100),
  ('toys', 'barbie doll accessories', true, 100),
  ('toys', 'hot wheels cars track', true, 100),
  ('toys', 'nerf gun blaster', true, 100),
  ('toys', 'puzzle board game family', true, 100),
  ('toys', 'remote control car kids', true, 100),
  ('toys', 'action figure collectible', true, 100),
  ('toys', 'plush stuffed animal', true, 100),
  ('toys', 'educational toys stem', true, 100),
  ('toys', 'play doh creative set', true, 100)
ON CONFLICT DO NOTHING;

-- Add starter seeds for sporting_goods
INSERT INTO home_section_seeds (section_key, query, enabled, weight) VALUES
  ('sporting_goods', 'basketball shoes court', true, 100),
  ('sporting_goods', 'yoga mat exercise', true, 100),
  ('sporting_goods', 'dumbbells weight set', true, 100),
  ('sporting_goods', 'running shoes mens', true, 100),
  ('sporting_goods', 'fitness tracker band', true, 100),
  ('sporting_goods', 'soccer ball football', true, 100),
  ('sporting_goods', 'camping tent outdoor', true, 100),
  ('sporting_goods', 'bicycle bike mountain', true, 100),
  ('sporting_goods', 'resistance bands exercise', true, 100),
  ('sporting_goods', 'tennis racket set', true, 100)
ON CONFLICT DO NOTHING;

-- Migrate computers seeds to electronics (since sectionProfiles.ts merges them)
UPDATE home_section_seeds SET section_key = 'electronics' WHERE section_key = 'computers' AND NOT EXISTS (
  SELECT 1 FROM home_section_seeds e WHERE e.section_key = 'electronics' AND e.query = home_section_seeds.query
);