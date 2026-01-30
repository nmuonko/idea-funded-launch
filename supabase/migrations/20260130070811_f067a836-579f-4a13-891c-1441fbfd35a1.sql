-- ============================================================================
-- Create search_rewrites table for French → English search query rewrites
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.search_rewrites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lang text NOT NULL DEFAULT 'fr',
  pattern text NOT NULL,
  rewrite text NOT NULL,
  category_key text DEFAULT NULL,
  priority integer NOT NULL DEFAULT 50,
  enabled boolean NOT NULL DEFAULT true,
  notes text DEFAULT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast pattern lookups
CREATE INDEX idx_search_rewrites_lang_enabled ON public.search_rewrites(lang, enabled);
CREATE INDEX idx_search_rewrites_pattern ON public.search_rewrites(pattern);

-- Unique constraint: one pattern per language (category can be null)
CREATE UNIQUE INDEX idx_search_rewrites_unique ON public.search_rewrites(lang, pattern, COALESCE(category_key, ''));

-- Enable RLS
ALTER TABLE public.search_rewrites ENABLE ROW LEVEL SECURITY;

-- Public read access for edge functions
CREATE POLICY "Anyone can read search_rewrites" ON public.search_rewrites
  FOR SELECT USING (true);

-- Admin write access
CREATE POLICY "Admins can manage search_rewrites" ON public.search_rewrites
  FOR ALL USING (public.is_admin());

-- Trigger for updated_at
CREATE TRIGGER update_search_rewrites_updated_at
  BEFORE UPDATE ON public.search_rewrites
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- Seed French → English rewrites (~120 rules)
-- ============================================================================

INSERT INTO public.search_rewrites (lang, pattern, rewrite, category_key, priority, notes) VALUES
-- ═══════════════════════════════════════════════════════════════════════════
-- ELECTRONICS / PHONES
-- ═══════════════════════════════════════════════════════════════════════════
('fr', 'telephone', 'smartphone', NULL, 100, 'Generic phone'),
('fr', 'telephone portable', 'smartphone', NULL, 100, 'Mobile phone'),
('fr', 'portable', 'smartphone', NULL, 90, 'Mobile phone colloquial'),
('fr', 'gsm', 'smartphone', NULL, 90, 'GSM phone'),
('fr', 'telephone mobile', 'smartphone mobile phone', NULL, 95, 'Mobile phone'),
('fr', 'telephone pas cher', 'budget smartphone', NULL, 80, 'Budget phone'),
('fr', 'smartphone africain', 'tecno infinix itel smartphone', NULL, 85, 'African market phones'),
('fr', 'telephone tecno', 'tecno smartphone', NULL, 100, 'Tecno brand'),
('fr', 'telephone itel', 'itel smartphone', NULL, 100, 'Itel brand'),
('fr', 'telephone infinix', 'infinix smartphone', NULL, 100, 'Infinix brand'),
('fr', 'telephone samsung', 'samsung galaxy smartphone', NULL, 100, 'Samsung brand'),
('fr', 'telephone iphone', 'iphone apple', NULL, 100, 'iPhone'),
('fr', 'ecouteurs', 'earbuds headphones', NULL, 90, 'Earbuds'),
('fr', 'ecouteurs sans fil', 'wireless earbuds bluetooth', NULL, 95, 'Wireless earbuds'),
('fr', 'casque audio', 'headphones over ear', NULL, 90, 'Headphones'),
('fr', 'casque bluetooth', 'wireless bluetooth headphones', NULL, 95, 'Bluetooth headphones'),
('fr', 'chargeur', 'charger cable', NULL, 80, 'Charger'),
('fr', 'chargeur telephone', 'phone charger usb', NULL, 85, 'Phone charger'),
('fr', 'batterie externe', 'power bank portable charger', NULL, 90, 'Power bank'),
('fr', 'coque telephone', 'phone case cover', NULL, 85, 'Phone case'),
('fr', 'protection ecran', 'screen protector tempered glass', NULL, 85, 'Screen protector'),
('fr', 'tablette', 'tablet android ipad', NULL, 90, 'Tablet'),
('fr', 'ordinateur', 'laptop computer', NULL, 90, 'Computer'),
('fr', 'ordinateur portable', 'laptop notebook', NULL, 95, 'Laptop'),
('fr', 'pc portable', 'laptop notebook computer', NULL, 95, 'Laptop PC'),
('fr', 'clavier', 'keyboard', NULL, 85, 'Keyboard'),
('fr', 'souris', 'mouse computer', NULL, 85, 'Mouse'),
('fr', 'ecran', 'monitor display screen', NULL, 85, 'Monitor'),
('fr', 'imprimante', 'printer', NULL, 85, 'Printer'),
('fr', 'cle usb', 'usb flash drive', NULL, 85, 'USB drive'),
('fr', 'disque dur', 'hard drive hdd ssd', NULL, 85, 'Hard drive'),
('fr', 'appareil photo', 'camera digital', NULL, 90, 'Camera'),
('fr', 'camera', 'camera video', NULL, 80, 'Camera/Video'),
('fr', 'enceinte bluetooth', 'bluetooth speaker portable', NULL, 90, 'Bluetooth speaker'),
('fr', 'haut parleur', 'speaker audio', NULL, 85, 'Speaker'),
('fr', 'montre connectee', 'smartwatch fitness tracker', NULL, 90, 'Smartwatch'),
('fr', 'montre intelligente', 'smartwatch apple watch', NULL, 90, 'Smartwatch'),

-- ═══════════════════════════════════════════════════════════════════════════
-- GAMING
-- ═══════════════════════════════════════════════════════════════════════════
('fr', 'jeux video', 'video games gaming', NULL, 95, 'Video games'),
('fr', 'jeu video', 'video game', NULL, 95, 'Video game'),
('fr', 'console de jeux', 'gaming console', NULL, 95, 'Gaming console'),
('fr', 'console', 'gaming console playstation xbox', NULL, 80, 'Console generic'),
('fr', 'playstation', 'playstation ps5 ps4', NULL, 100, 'PlayStation'),
('fr', 'manette', 'controller gamepad', NULL, 90, 'Controller'),
('fr', 'manette ps5', 'ps5 dualsense controller', NULL, 100, 'PS5 controller'),
('fr', 'manette xbox', 'xbox controller wireless', NULL, 100, 'Xbox controller'),
('fr', 'manette ps4', 'ps4 dualshock controller', NULL, 100, 'PS4 controller'),
('fr', 'nintendo', 'nintendo switch', NULL, 100, 'Nintendo'),
('fr', 'casque gaming', 'gaming headset headphones', NULL, 90, 'Gaming headset'),
('fr', 'clavier gaming', 'gaming keyboard mechanical', NULL, 90, 'Gaming keyboard'),
('fr', 'souris gaming', 'gaming mouse rgb', NULL, 90, 'Gaming mouse'),
('fr', 'chaise gaming', 'gaming chair ergonomic', NULL, 85, 'Gaming chair'),

-- ═══════════════════════════════════════════════════════════════════════════
-- VEHICLES
-- ═══════════════════════════════════════════════════════════════════════════
('fr', 'voiture', 'car automobile vehicle', NULL, 95, 'Car'),
('fr', 'voiture occasion', 'used car vehicle', NULL, 90, 'Used car'),
('fr', 'voiture neuve', 'new car vehicle', NULL, 90, 'New car'),
('fr', 'moto', 'motorcycle motorbike', NULL, 95, 'Motorcycle'),
('fr', 'motocyclette', 'motorcycle', NULL, 90, 'Motorcycle formal'),
('fr', 'scooter', 'scooter moped', NULL, 90, 'Scooter'),
('fr', 'camion', 'truck lorry', NULL, 90, 'Truck'),
('fr', 'camionnette', 'van pickup truck', NULL, 90, 'Van/Pickup'),
('fr', 'pieces auto', 'car parts auto parts', NULL, 95, 'Car parts'),
('fr', 'pieces detachees', 'spare parts auto', NULL, 90, 'Spare parts'),
('fr', 'pneu', 'tire tyre', NULL, 90, 'Tire'),
('fr', 'pneus', 'tires tyres', NULL, 90, 'Tires'),
('fr', 'batterie voiture', 'car battery auto', NULL, 90, 'Car battery'),
('fr', 'huile moteur', 'motor oil engine oil', NULL, 90, 'Motor oil'),
('fr', 'filtre huile', 'oil filter', NULL, 85, 'Oil filter'),
('fr', 'phare', 'headlight headlamp', NULL, 85, 'Headlight'),
('fr', 'retroviseur', 'mirror side mirror rearview', NULL, 85, 'Mirror'),
('fr', 'amortisseur', 'shock absorber suspension', NULL, 85, 'Shock absorber'),
('fr', 'frein', 'brake pads disc', NULL, 85, 'Brakes'),
('fr', 'velo', 'bicycle bike', NULL, 90, 'Bicycle'),
('fr', 'velo electrique', 'electric bike ebike', NULL, 95, 'Electric bike'),

-- ═══════════════════════════════════════════════════════════════════════════
-- CLOTHING - GENERAL
-- ═══════════════════════════════════════════════════════════════════════════
('fr', 'vetements', 'clothing clothes apparel', NULL, 90, 'Clothing general'),
('fr', 'vetement', 'clothing clothes', NULL, 85, 'Clothing singular'),
('fr', 'habits', 'clothing clothes', NULL, 80, 'Clothing colloquial'),
('fr', 'mode', 'fashion clothing', NULL, 70, 'Fashion'),
('fr', 'chaussures', 'shoes footwear', NULL, 95, 'Shoes'),
('fr', 'chaussure', 'shoes', NULL, 90, 'Shoe singular'),
('fr', 'baskets', 'sneakers shoes athletic', NULL, 95, 'Sneakers'),
('fr', 'tennis', 'sneakers athletic shoes', NULL, 85, 'Tennis shoes'),
('fr', 'sandales', 'sandals', NULL, 90, 'Sandals'),
('fr', 'bottes', 'boots', NULL, 90, 'Boots'),
('fr', 'talons', 'heels high heels', NULL, 90, 'Heels'),
('fr', 'robe', 'dress', NULL, 95, 'Dress'),
('fr', 'robes', 'dresses', NULL, 95, 'Dresses'),
('fr', 'jupe', 'skirt', NULL, 90, 'Skirt'),
('fr', 'pantalon', 'pants trousers', NULL, 90, 'Pants'),
('fr', 'jean', 'jeans denim', NULL, 90, 'Jeans'),
('fr', 'short', 'shorts', NULL, 85, 'Shorts'),
('fr', 'chemise', 'shirt dress shirt', NULL, 90, 'Shirt'),
('fr', 'tshirt', 't-shirt tee', NULL, 85, 'T-shirt'),
('fr', 't-shirt', 't-shirt tee', NULL, 85, 'T-shirt'),
('fr', 'pull', 'sweater pullover', NULL, 90, 'Sweater'),
('fr', 'sweat', 'sweatshirt hoodie', NULL, 90, 'Sweatshirt'),
('fr', 'veste', 'jacket', NULL, 90, 'Jacket'),
('fr', 'manteau', 'coat jacket winter', NULL, 90, 'Coat'),
('fr', 'blouson', 'jacket bomber', NULL, 85, 'Jacket/Bomber'),
('fr', 'costume', 'suit formal', NULL, 90, 'Suit'),

-- ═══════════════════════════════════════════════════════════════════════════
-- CLOTHING - WOMEN
-- ═══════════════════════════════════════════════════════════════════════════
('fr', 'vetements femme', 'women clothing womens clothes', 'clothing_women', 100, 'Women clothing'),
('fr', 'robe femme', 'women dress', 'clothing_women', 100, 'Women dress'),
('fr', 'chaussures femme', 'women shoes womens footwear', 'clothing_women', 100, 'Women shoes'),
('fr', 'sac femme', 'women handbag purse', 'clothing_women', 95, 'Women bag'),
('fr', 'lingerie', 'lingerie underwear women', 'clothing_women', 90, 'Lingerie'),
('fr', 'sous vetements femme', 'women underwear lingerie', 'clothing_women', 95, 'Women underwear'),

-- ═══════════════════════════════════════════════════════════════════════════
-- CLOTHING - MEN
-- ═══════════════════════════════════════════════════════════════════════════
('fr', 'vetements homme', 'men clothing mens clothes', 'clothing_men', 100, 'Men clothing'),
('fr', 'chemise homme', 'men shirt dress shirt', 'clothing_men', 100, 'Men shirt'),
('fr', 'chaussures homme', 'men shoes mens footwear', 'clothing_men', 100, 'Men shoes'),
('fr', 'costume homme', 'men suit formal', 'clothing_men', 100, 'Men suit'),
('fr', 'sous vetements homme', 'men underwear boxers', 'clothing_men', 95, 'Men underwear'),
('fr', 'cravate', 'tie necktie', 'clothing_men', 90, 'Necktie'),

-- ═══════════════════════════════════════════════════════════════════════════
-- CLOTHING - GIRLS
-- ═══════════════════════════════════════════════════════════════════════════
('fr', 'vetements fille', 'girls clothing kids clothes', 'clothing_girls', 100, 'Girls clothing'),
('fr', 'robe fille', 'girls dress kids dress', 'clothing_girls', 100, 'Girls dress'),
('fr', 'chaussures fille', 'girls shoes kids footwear', 'clothing_girls', 100, 'Girls shoes'),

-- ═══════════════════════════════════════════════════════════════════════════
-- CLOTHING - BOYS
-- ═══════════════════════════════════════════════════════════════════════════
('fr', 'vetements garcon', 'boys clothing kids clothes', 'clothing_boys', 100, 'Boys clothing'),
('fr', 'chaussures garcon', 'boys shoes kids footwear', 'clothing_boys', 100, 'Boys shoes'),

-- ═══════════════════════════════════════════════════════════════════════════
-- CLOTHING - BABY
-- ═══════════════════════════════════════════════════════════════════════════
('fr', 'vetements bebe', 'baby clothes infant clothing', 'clothing_baby', 100, 'Baby clothing'),
('fr', 'body bebe', 'baby bodysuit onesie', 'clothing_baby', 95, 'Baby bodysuit'),
('fr', 'pyjama bebe', 'baby pajamas sleepwear', 'clothing_baby', 95, 'Baby pajamas'),
('fr', 'chaussures bebe', 'baby shoes infant footwear', 'clothing_baby', 100, 'Baby shoes'),
('fr', 'couches', 'diapers nappies', 'clothing_baby', 90, 'Diapers'),

-- ═══════════════════════════════════════════════════════════════════════════
-- BAGS & LUGGAGE
-- ═══════════════════════════════════════════════════════════════════════════
('fr', 'sac', 'bag handbag', NULL, 80, 'Bag generic'),
('fr', 'sac a main', 'handbag purse', NULL, 95, 'Handbag'),
('fr', 'sac a dos', 'backpack', NULL, 95, 'Backpack'),
('fr', 'sac de voyage', 'travel bag duffle', NULL, 95, 'Travel bag'),
('fr', 'valise', 'suitcase luggage', 'clothing_luggage', 100, 'Suitcase'),
('fr', 'valises', 'luggage suitcase set', 'clothing_luggage', 100, 'Suitcases'),
('fr', 'bagages', 'luggage suitcase travel', 'clothing_luggage', 100, 'Luggage'),
('fr', 'bagage cabine', 'carry on luggage cabin', 'clothing_luggage', 95, 'Carry on'),
('fr', 'trolley', 'trolley luggage wheeled', 'clothing_luggage', 90, 'Trolley bag'),

-- ═══════════════════════════════════════════════════════════════════════════
-- BEAUTY / COSMETICS
-- ═══════════════════════════════════════════════════════════════════════════
('fr', 'parfum', 'perfume fragrance', NULL, 95, 'Perfume'),
('fr', 'parfum homme', 'mens cologne perfume', NULL, 100, 'Men cologne'),
('fr', 'parfum femme', 'women perfume fragrance', NULL, 100, 'Women perfume'),
('fr', 'maquillage', 'makeup cosmetics', NULL, 95, 'Makeup'),
('fr', 'rouge a levres', 'lipstick lip color', NULL, 95, 'Lipstick'),
('fr', 'fond de teint', 'foundation makeup', NULL, 95, 'Foundation'),
('fr', 'mascara', 'mascara eyelash', NULL, 90, 'Mascara'),
('fr', 'fard a paupieres', 'eyeshadow palette', NULL, 90, 'Eyeshadow'),
('fr', 'vernis a ongles', 'nail polish lacquer', NULL, 90, 'Nail polish'),
('fr', 'creme visage', 'face cream moisturizer', NULL, 90, 'Face cream'),
('fr', 'soin peau', 'skincare skin care', NULL, 90, 'Skincare'),
('fr', 'shampoing', 'shampoo hair', NULL, 85, 'Shampoo'),
('fr', 'apres shampoing', 'conditioner hair', NULL, 85, 'Conditioner'),

-- ═══════════════════════════════════════════════════════════════════════════
-- JEWELRY / WATCHES
-- ═══════════════════════════════════════════════════════════════════════════
('fr', 'bijoux', 'jewelry jewellery', NULL, 95, 'Jewelry'),
('fr', 'bijou', 'jewelry', NULL, 90, 'Jewelry singular'),
('fr', 'collier', 'necklace chain', NULL, 90, 'Necklace'),
('fr', 'bracelet', 'bracelet bangle', NULL, 90, 'Bracelet'),
('fr', 'bague', 'ring', NULL, 90, 'Ring'),
('fr', 'boucles oreilles', 'earrings', NULL, 95, 'Earrings'),
('fr', 'montre', 'watch wristwatch', NULL, 95, 'Watch'),
('fr', 'montre homme', 'men watch wristwatch', NULL, 100, 'Men watch'),
('fr', 'montre femme', 'women watch wristwatch', NULL, 100, 'Women watch'),

-- ═══════════════════════════════════════════════════════════════════════════
-- HOME & GARDEN
-- ═══════════════════════════════════════════════════════════════════════════
('fr', 'maison', 'home household', NULL, 75, 'Home'),
('fr', 'meuble', 'furniture', NULL, 85, 'Furniture singular'),
('fr', 'meubles', 'furniture home', NULL, 90, 'Furniture'),
('fr', 'canape', 'sofa couch', NULL, 90, 'Sofa'),
('fr', 'lit', 'bed bedroom', NULL, 85, 'Bed'),
('fr', 'matelas', 'mattress bed', NULL, 90, 'Mattress'),
('fr', 'table', 'table desk', NULL, 80, 'Table'),
('fr', 'chaise', 'chair seat', NULL, 80, 'Chair'),
('fr', 'armoire', 'wardrobe closet cabinet', NULL, 85, 'Wardrobe'),
('fr', 'cuisine', 'kitchen cookware', NULL, 80, 'Kitchen'),
('fr', 'refrigerateur', 'refrigerator fridge', NULL, 90, 'Refrigerator'),
('fr', 'four', 'oven microwave', NULL, 80, 'Oven'),
('fr', 'machine a laver', 'washing machine washer', NULL, 95, 'Washing machine'),
('fr', 'aspirateur', 'vacuum cleaner', NULL, 90, 'Vacuum cleaner'),
('fr', 'climatiseur', 'air conditioner ac', NULL, 90, 'Air conditioner'),
('fr', 'ventilateur', 'fan electric', NULL, 90, 'Fan'),

-- ═══════════════════════════════════════════════════════════════════════════
-- SPORTS & FITNESS
-- ═══════════════════════════════════════════════════════════════════════════
('fr', 'sport', 'sports fitness', NULL, 80, 'Sports'),
('fr', 'ballon', 'ball sports', NULL, 80, 'Ball'),
('fr', 'ballon football', 'soccer ball football', NULL, 90, 'Soccer ball'),
('fr', 'halteres', 'dumbbells weights', NULL, 90, 'Dumbbells'),
('fr', 'tapis yoga', 'yoga mat fitness', NULL, 90, 'Yoga mat'),
('fr', 'velo appartement', 'exercise bike stationary', NULL, 90, 'Exercise bike'),
('fr', 'tapis roulant', 'treadmill running', NULL, 90, 'Treadmill'),

-- ═══════════════════════════════════════════════════════════════════════════
-- TOYS
-- ═══════════════════════════════════════════════════════════════════════════
('fr', 'jouet', 'toy kids', NULL, 90, 'Toy singular'),
('fr', 'jouets', 'toys kids children', NULL, 95, 'Toys'),
('fr', 'poupee', 'doll toy', NULL, 90, 'Doll'),
('fr', 'peluche', 'stuffed animal plush toy', NULL, 90, 'Plush toy'),
('fr', 'lego', 'lego building blocks', NULL, 100, 'LEGO'),
('fr', 'puzzle', 'puzzle jigsaw', NULL, 85, 'Puzzle'),
('fr', 'jeu de societe', 'board game', NULL, 90, 'Board game')

ON CONFLICT (lang, pattern, COALESCE(category_key, '')) 
DO UPDATE SET
  rewrite = EXCLUDED.rewrite,
  priority = EXCLUDED.priority,
  notes = EXCLUDED.notes,
  updated_at = now();