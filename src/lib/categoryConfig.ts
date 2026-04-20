import { Product } from '@/components/shop/ProductCard';

// ===== CATEGORY TITLE MAP =====
export const CATEGORY_TITLE_MAP: Record<string, Record<string, string>> = {
  phones: { fr: 'Téléphones', en: 'Phones' },
  electronics: { fr: 'Électronique', en: 'Electronics' },
  gaming: { fr: 'Jeux Vidéo', en: 'Gaming' },
  vehicles: { fr: 'Véhicules', en: 'Vehicles' },
  clothing: { fr: 'Mode', en: 'Fashion' },
  home_garden: { fr: 'Salon, Salle à Manger & Cuisine', en: 'Home & Living' },
  toys: { fr: 'Jouets', en: 'Toys' },
  sporting_goods: { fr: 'Sport', en: 'Sports' },
  jewelry_watches: { fr: 'Montres & Bijoux', en: 'Jewelry & Watches' },
  parts_accessories: { fr: 'Pièces Auto', en: 'Parts & Accessories' },
  refurbished: { fr: 'Reconditionné', en: 'Refurbished' },
  beauty_health: { fr: 'Beauté & Santé', en: 'Beauty & Health' },
  collectibles: { fr: 'Collections', en: 'Collectibles' },
  audio_music: { fr: 'Audio & Musique', en: 'Audio & Music' },
  shoes_sneakers: { fr: 'Chaussures & Sneakers', en: 'Shoes & Sneakers' },
  cameras_photo: { fr: 'Caméras & Photo', en: 'Cameras & Photo' },
};

// ===== FALLBACK SEARCH QUERIES =====
export const CATEGORY_SEARCH_QUERIES: Record<string, string[]> = {
  computers: ['MacBook Pro laptop', 'Dell XPS laptop', 'Lenovo ThinkPad laptop', 'ASUS ROG gaming laptop'],
  phones: ['iPhone 15 Pro Max', 'Samsung Galaxy S24 Ultra', 'Google Pixel 8 Pro', 'OnePlus 12 smartphone'],
  electronics: ['laptop notebook computer', 'tablet iPad Samsung', 'monitor 4K display', 'drone camera'],
  gaming: ['PS5 console bundle', 'Nintendo Switch OLED', 'Xbox Series X', 'Steam Deck gaming'],
  vehicles: ['Tesla Model X used car', 'Range Rover SUV used', 'Mercedes GLS SUV used', 'BMW X7 SUV used'],
  clothing: ['women long maxi dress', 'mens jacket coat', 'abaya kaftan long dress', 'women blazer suit'],
  home_garden: ['sofa living room furniture', 'kitchen appliance blender', 'bed frame mattress', 'garden outdoor patio'],
  toys: ['LEGO building set', 'Barbie doll playset', 'Nerf blaster gun', 'puzzle board game'],
  sporting_goods: ['treadmill home gym', 'dumbbell weight set', 'yoga mat fitness', 'bicycle mountain bike'],
  jewelry_watches: ['Rolex luxury watch', 'gold diamond necklace', 'Casio Seiko watch', 'silver bracelet jewelry'],
  parts_accessories: ['brake pad rotor', 'car headlight assembly', 'OEM auto parts', 'catalytic converter exhaust'],
  refurbished: ['refurbished iPhone certified', 'renewed MacBook laptop', 'refurbished iPad tablet', 'certified pre-owned Samsung'],
  beauty_health: ['perfume fragrance', 'skincare serum moisturizer', 'makeup cosmetics lipstick', 'hair dryer curling iron'],
  collectibles: ['Funko Pop vinyl figure', 'Pokemon cards booster', 'vintage antique collectible', 'sports memorabilia signed autograph'],
  audio_music: ['bluetooth speaker JBL Bose', 'headphones wireless noise cancelling', 'electric guitar acoustic', 'turntable vinyl record player'],
  shoes_sneakers: ['Nike Air Max sneakers', 'Adidas Yeezy shoes', 'Jordan retro basketball shoe', 'New Balance running shoe'],
  cameras_photo: ['Canon EOS DSLR camera', 'Sony Alpha mirrorless camera', 'GoPro action camera', 'camera lens tripod'],
};

// ===== CATEGORY KEYWORDS =====
export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  computers: ['laptop', 'notebook', 'computer', 'macbook', 'chromebook', 'dell laptop', 'lenovo laptop', 'asus laptop', 'acer laptop', 'hp laptop', 'gaming laptop', 'desktop computer', 'all-in-one pc', 'workstation', 'thinkpad', 'inspiron', 'pavilion', 'surface laptop', 'surface pro', 'ideapad', 'zenbook', 'vivobook', 'elitebook', 'probook', 'latitude', 'precision', 'envy', 'omen', 'predator', 'rog', 'razer blade', 'msi laptop', 'pc portable', 'ordinateur'],
  phones: ['iphone', 'samsung galaxy', 'pixel phone', 'google pixel', 'smartphone', 'android phone', 'unlocked phone', 'cellphone', 'téléphone', 'oneplus', 'xiaomi', 'motorola', 'galaxy s2', 'galaxy s3', 'galaxy z fold', 'galaxy z flip', 'galaxy a5', 'galaxy a7', 'galaxy s24', 'galaxy s23', 'galaxy s22', 'galaxy note', 'iphone 1', 'iphone pro', 'iphone plus'],
  electronics: ['laptop', 'notebook', 'computer', 'tablet', 'monitor', 'headphone', 'speaker', 'camera', 'drone', 'television', 'earbuds', 'printer', 'router', 'hard drive', 'ssd', 'gpu', 'cpu', 'macbook', 'ipad', 'dell laptop', 'lenovo laptop', 'asus laptop', 'acer laptop', 'oled tv', 'qled tv', '4k tv', 'smart tv', 'mechanical keyboard', 'webcam', 'projector', 'soundbar', 'electronic', 'tech', 'gadget', 'smart home', 'alexa', 'echo', 'google home', 'fire stick', 'chromecast', 'apple tv', 'roku', 'modem', 'switch', 'network', 'server', 'nas', 'external drive', 'flash drive', 'usb hub', 'power strip', 'ups', 'surge protector'],
  gaming: ['ps5', 'playstation 5', 'playstation 4', 'xbox series', 'xbox one', 'nintendo switch', 'switch oled', 'video game', 'steam deck', 'gaming laptop', 'gaming monitor', 'gaming headset', 'dualsense', 'game disc', 'ps4', 'xbox console', 'controller', 'gamepad', 'joystick', 'gaming pc', 'rtx 40', 'rtx 30', 'geforce rtx'],
  vehicles: ['toyota', 'honda', 'bmw', 'ford f-', 'ford mustang', 'ford explorer', 'ford escape', 'motorcycle', 'jeep', 'nissan', 'mercedes-benz', 'mercedes benz', 'audi', 'hyundai', 'kia', 'chevrolet', 'land cruiser', 'mustang', 'rav4', 'cr-v', 'sedan', 'convertible', 'minivan', 'corvette', 'camaro', 'civic', 'accord', 'corolla', 'tacoma', 'wrangler', 'range rover', 'lexus', 'cadillac', 'escalade', 'tesla model'],
  clothing: ['shirt', 't-shirt', 'polo', 'hoodie', 'jacket', 'coat', 'jeans', 'pants', 'trousers', 'dress', 'skirt', 'suit', 'blazer', 'sweater', 'cardigan', 'abaya', 'kaftan', 'chemise', 'veste', 'pantalon', 'robe', 'manteau', 'pull', 'vêtement', 'blouse', 'sweatshirt', 'legging', 'tracksuit', 'handbag', 'gucci', 'prada', 'dior', 'burberry', 'louis vuitton', 'apparel', 'outfit', 'fashion', 'wear', 'garment', 'uniform', 'vest', 'cape', 'poncho', 'scarf', 'shawl', 'hat', 'cap', 'glove', 'belt', 'tie', 'tuxedo', 'kimono', 'dashiki', 'boubou'],
  home_garden: ['sofa', 'couch', 'dining table', 'bed frame', 'mattress', 'blender', 'microwave', 'oven', 'refrigerator', 'lamp', 'furniture', 'curtain', 'rug', 'shelf', 'cabinet', 'air conditioner', 'washer', 'dryer', 'dishwasher', 'vacuum', 'coffee maker', 'recliner', 'bookshelf', 'generator', 'solar panel', 'freezer', 'fridge', 'kitchen', 'living room', 'garden', 'patio', 'outdoor', 'indoor', 'planter', 'grill', 'lawn', 'mower', 'fan', 'heater', 'humidifier', 'dehumidifier', 'iron', 'toaster', 'mixer', 'food processor', 'pressure cooker', 'instant pot', 'air fryer', 'slow cooker'],
  toys: ['toy', 'jouet', 'lego', 'doll', 'puzzle', 'action figure', 'barbie', 'nerf', 'playset', 'plush', 'stuffed animal', 'board game', 'play-doh', 'hot wheels', 'building blocks', 'toy set'],
  sporting_goods: ['fitness equipment', 'gym equipment', 'yoga mat', 'running shoe', 'bicycle', 'soccer ball', 'basketball', 'tennis racket', 'golf club', 'camping', 'hiking', 'treadmill', 'dumbbell', 'exercise bike', 'kayak', 'garmin watch', 'sport', 'athletic', 'exercise', 'football', 'baseball', 'volleyball', 'cricket', 'boxing', 'martial arts', 'swimming', 'surfboard', 'skateboard', 'roller skate', 'helmet', 'knee pad', 'elbow pad', 'resistance band', 'jump rope', 'pull up bar', 'bench press', 'weight', 'barbell', 'kettlebell'],
  jewelry_watches: ['watch ', 'montre', 'bracelet', 'necklace', 'ring ', 'earring', 'jewelry', 'bijou', 'gold necklace', 'gold ring', 'gold bracelet', 'silver necklace', 'silver ring', 'diamond', 'rolex', 'casio watch', 'seiko', 'fossil watch', 'pendant', 'luxury watch', '14k', '18k', '10k gold'],
  parts_accessories: ['auto part', 'car part', 'brake pad', 'oil filter', 'alternator', 'car battery', 'headlight assembly', 'bumper', 'wiper blade', 'spark plug', 'transmission', 'radiator', 'pièce auto', 'oem part', 'catalytic converter', 'exhaust', 'strut', 'control arm', 'axle', 'wheel bearing', 'fuel pump', 'thermostat', 'serpentine belt', 'timing belt', 'car accessory', 'vehicle part', 'engine', 'muffler', 'caliper', 'rotor', 'gasket', 'clutch', 'differential', 'suspension', 'tie rod', 'ball joint', 'sway bar', 'power steering', 'water pump', 'oxygen sensor', 'mass air flow', 'ignition coil'],
  refurbished: ['refurbished', 'renewed', 'reconditioned', 'reconditionné', 'certified pre-owned', 'factory refurbished', 'pre-owned', 'used', 'open box', 'like new', 'grade a', 'grade b', 'restored', 'geek squad certified'],
  beauty_health: ['perfume', 'cologne', 'skincare', 'makeup', 'lipstick', 'foundation', 'serum', 'moisturizer', 'shampoo', 'hair dryer', 'fragrance', 'cosmetic', 'face cream', 'nail polish', 'lotion', 'vitamins', 'beauty', 'health', 'cream', 'body wash', 'soap', 'deodorant', 'hair', 'skin', 'nail', 'brush', 'curling iron', 'straightener', 'derma', 'sunscreen', 'anti-aging', 'cleanser', 'toner', 'mascara', 'eyeshadow', 'blush', 'concealer', 'primer'],
  collectibles: ['trading card', 'pokemon card', 'vintage', 'antique', 'collectible', 'memorabilia', 'comic book', 'figurine', 'rare coin', 'yugioh', 'collection', 'limited edition', 'signed', 'autograph', 'first edition', 'mint condition', 'graded', 'psa', 'cgc', 'funko pop', 'hot toys', 'statue', 'bust', 'replica', 'prop'],
  audio_music: ['speaker', 'subwoofer', 'soundbar', 'home theater', 'amplifier', 'receiver', 'headphones', 'earbuds', 'bluetooth speaker', 'studio monitor', 'pa speaker', 'guitar', 'electric guitar', 'acoustic guitar', 'bass guitar', 'digital piano', 'midi controller', 'drum', 'drum kit', 'microphone', 'audio interface', 'turntable', 'hi-fi', 'surround sound', 'wireless speaker', 'portable speaker', 'bose', 'jbl', 'harman kardon', 'bang & olufsen', 'sennheiser', 'marshall', 'beats', 'audio', 'music'],
  shoes_sneakers: ['nike', 'adidas', 'jordan', 'air max', 'new balance', 'puma', 'reebok', 'converse', 'vans', 'sneakers', 'running shoe', 'basketball shoe', 'yeezy', 'air force 1', 'dunk low', 'dunk high', 'boot', 'loafer', 'sandal', 'trail shoe', 'hiking boot', 'timberland', 'skechers', 'asics', 'under armour', 'shoe'],
  cameras_photo: ['canon', 'nikon', 'sony camera', 'sony alpha', 'fujifilm', 'gopro', 'dslr', 'mirrorless camera', 'camera lens', 'tripod', 'ring light', 'camera bag', 'drone camera', 'action camera', 'instant camera', 'polaroid', 'digital camera', 'camcorder', 'camera body', 'telephoto lens', 'wide angle lens', 'canon eos', 'nikon z', 'camera', 'photo', 'photography', 'lumix', 'leica', 'olympus', 'flash', 'studio light', 'softbox', 'backdrop'],
};

// ===== GLOBAL HARD EXCLUDES =====
const GLOBAL_SHOE_TERMS = ['shoe', 'shoes', 'sneaker', 'sneakers', 'boot', 'boots', 'nike', 'jordan', 'air max', 'yeezy', 'adidas', 'puma', 'new balance', 'reebok', 'converse', 'vans', 'timberland', 'skechers', 'asics', 'dunk low', 'dunk high', 'air force 1', 'loafer', 'sandal'];
const GLOBAL_WATCH_JEWELRY_TERMS = ['watch', 'smartwatch', 'apple watch', 'rolex', 'omega', 'cartier', 'seiko', 'casio', 'fossil', 'montre', 'necklace', 'pendant', 'ring', 'bracelet', 'earring', 'diamond', 'gold chain', 'jewelry', 'bijou'];
const GLOBAL_TOY_TERMS = ['toy', 'toys', 'lego', 'puzzle', 'doll', 'action figure', 'barbie', 'building set', 'playset', 'jouet', 'nerf', 'plush', 'stuffed animal', 'hot wheels', 'play-doh'];

const SHOE_OWNER_CATS = new Set(['shoes_sneakers', 'sporting_goods', 'clothing']);
const WATCH_JEWELRY_OWNER_CATS = new Set(['jewelry_watches']);
const TOY_OWNER_CATS = new Set(['toys', 'collectibles']);

export const CATEGORY_EXCLUDE_KEYWORDS: Record<string, string[]> = {
  electronics: ['sofa', 'couch', 'recliner', 'dining', 'bed', 'mattress', 'rug', 'curtain', 'furniture', 'garden', 'pillow', 'décor', 'decor', 'dress', 'shirt', 'pants', 'clothing', 'fashion', 'phone case', 'screen protector', 'ps5', 'playstation', 'xbox', 'nintendo', 'console', 'game disc', 'guitar', 'drum', 'piano', 'yoga', 'exercise', 'workout', 'sport', 'perfume', 'cologne', 'makeup'],
  gaming: ['sofa', 'couch', 'bed', 'mattress', 'furniture', 'kitchen', 'garden', 'dress', 'shirt', 'charger', 'cable', 'cooling fan', 'internal fan', 'replacement fan', 'gaming chair', 'chair', 'desk', 'skin', 'decal', 'speaker', 'guitar', 'piano', 'perfume', 'sofa set', 'dining table', 'makeup', 'cologne'],
  phones: ['sofa', 'bed', 'table', 'chair', 'furniture', 'kitchen', 'garden', 'dress', 'mattress', 'case', 'protector', 'screen protector', 'cable', 'charger', 'mount', 'holder', 'stand', 'tempered glass', 'cover', 'wallet', 'strap', 'armband', 'phone case', 'phone mount', 'phone holder', 'phone stand', 'phone charger', 'phone cable', 'car mount', 'film', 'adapter', 'earphones', 'earbuds', 'headphone'],
  vehicles: ['iphone', 'macbook', 'ps5', 'laptop', 'tablet', 'smartphone', 'dress', 'shirt', 'sofa', 'bed', 'charger', 'cable', 'stereo', 'gps', 'carplay', 'android auto', 'dash cam', 'phone mount', 'car charger', 'phone holder', 'bluetooth adapter', 'fm transmitter', 'screen protector', 'tempered glass', 'floor mat', 'seat cover', 'phone', 'head unit', 'radio', 'brake pad', 'oil filter', 'wiper', 'spark plug', 'alternator', 'bumper cover', 'perfume', 'cologne'],
  clothing: ['iphone', 'ps5', 'macbook', 'laptop', 'tablet', 'sofa', 'couch', 'bed', 'mattress', 'fridge', 'microwave', 'phone case', 'car part', 'charger', 'cable', 'electronic', 'appliance', 'lego', 'toy', 'puzzle', 'doll', 'action figure', 'building block', 'playset', 'yoga mat', 'treadmill', 'dumbbell', 'exercise', 'auto part', 'brake pad', 'oil filter', 'car battery', 'headlight', 'spark plug', 'wiper', 'sofa set', 'dining table', 'refrigerator', 'vacuum', 'blender', 'lingerie', 'bikini', 'thong', 'lace bra', 'sexy', 'lingerie set', 'sneaker', 'sneakers', 'air max', 'air force 1', 'dunk low', 'dunk high', 'yeezy', 'running shoe', 'basketball shoe', 'hiking boot', 'camera', 'lens', 'tripod', 'mini dress', 'short dress', 'crop top', 'tank top', 'camisole', 'bralette', 'console', 'playstation', 'xbox', 'nintendo', 'game', 'controller', 'smartphone', 'samsung', 'pixel', 'android'],
  home_garden: ['iphone', 'ps5', 'macbook', 'laptop', 'smartphone', 'playstation', 'xbox', 'nintendo', 'gpu', 'earbuds', 'phone case', 'gaming', 'video game', 'console', 'hdmi', 'usb', 'cable', 'apple watch', 'smartwatch', 'airpods', 'headphones', 'samsung galaxy', 'trading card', 'pokemon', 'carplay', 'stereo', 'perfume', 'cologne', 'makeup', 'phone', 'samsung', 'tablet'],
  toys: ['iphone', 'macbook', 'laptop', 'sofa', 'bed', 'mattress', 'ps5', 'phone case', 'charger', 'cable', 'brake pad', 'oil filter', 'perfume', 'cologne'],
  sporting_goods: ['iphone', 'macbook', 'ps5', 'sofa', 'bed', 'mattress', 'laptop', 'tablet', 'phone case', 'gaming', 'charger', 'cable', 'console', 'playstation', 'xbox', 'nintendo', 'trading card', 'pokemon', 'perfume', 'cologne'],
  jewelry_watches: ['iphone', 'ps5', 'macbook', 'laptop', 'sofa', 'bed', 'mattress', 'phone case', 'charger', 'cable', 'tool', 'appliance', 'furniture', 'brake pad', 'perfume', 'cologne', 'makeup'],
  parts_accessories: ['iphone', 'samsung galaxy', 'macbook', 'laptop', 'ps5', 'playstation', 'xbox', 'nintendo', 'sofa', 'bed', 'dress', 'shirt', 'perfume', 'makeup', 'tablet', 'airpods', 'headphones', 'speaker', 'cologne', 'screen protector', 'tempered glass', 'phone', 'samsung'],
  beauty_health: ['sofa', 'bed', 'mattress', 'iphone', 'ps5', 'laptop', 'console', 'brake pad', 'car part', 'cable', 'charger', 'camera', 'lens', 'xbox', 'nintendo', 'playstation', 'phone', 'samsung', 'case', 'protector', 'computer', 'tablet', 'gaming'],
  collectibles: ['sofa', 'bed', 'mattress', 'iphone', 'laptop', 'ps5', 'brake pad', 'oil filter', 'charger', 'cable', 'perfume', 'cologne'],
  audio_music: ['ps5', 'playstation', 'xbox', 'nintendo', 'console', 'controller', 'game disc', 'gaming chair', 'cooling fan', 'video game', 'case', 'cover', 'protector', 'screen protector', 'tempered glass', 'mount', 'holder', 'stand', 'adapter', 'replacement', 'spare', 'repair', 'car gps', 'carplay', 'android auto', 'dash cam', 'phone case', 'sofa', 'bed', 'mattress', 'furniture', 'dress', 'shirt', 'brake pad', 'oil filter', 'perfume', 'cologne', 'makeup', 'phone', 'iphone', 'samsung', 'laptop', 'tablet', 'camera', 'lens', 'kindle', 'e-reader', 'ebook', 'paperwhite', 'reader'],
  shoes_sneakers: ['iphone', 'ps5', 'macbook', 'laptop', 'tablet', 'sofa', 'bed', 'mattress', 'phone case', 'charger', 'cable', 'lego', 'toy', 'car part', 'brake pad', 'console', 'gaming', 'perfume', 'cologne'],
  cameras_photo: ['sofa', 'bed', 'mattress', 'phone case', 'dress', 'shirt', 'lego', 'car part', 'charger cable', 'ps5', 'playstation', 'xbox', 'console', 'brake pad', 'oil filter', 'perfume', 'cologne', 'carplay', 'stereo', 'makeup', 'iphone', 'samsung galaxy', 'laptop', 'macbook', 'gaming', 'alienware', 'msi', 'dell', 'lenovo', 'asus', 'acer', 'hp pavilion', 'tablet', 'ipad', 'android', 'smartphone', 'phone', 'cellphone'],
  refurbished: [],
};

// Pre-compute effective excludes (cached per category, computed once at module load)
const _effectiveExcludesCache = new Map<string, string[]>();

export function getEffectiveExcludes(catKey: string): string[] {
  const cached = _effectiveExcludesCache.get(catKey);
  if (cached) return cached;

  const base = CATEGORY_EXCLUDE_KEYWORDS[catKey] || [];
  const extras: string[] = [];
  if (!SHOE_OWNER_CATS.has(catKey)) extras.push(...GLOBAL_SHOE_TERMS);
  if (!WATCH_JEWELRY_OWNER_CATS.has(catKey)) extras.push(...GLOBAL_WATCH_JEWELRY_TERMS);
  if (!TOY_OWNER_CATS.has(catKey)) extras.push(...GLOBAL_TOY_TERMS);
  const result = [...new Set([...base, ...extras])];
  _effectiveExcludesCache.set(catKey, result);
  return result;
}

export function isRelevantToCategory(product: Product, categoryKey: string): boolean {
  if (categoryKey === 'all') return true;
  const keywords = CATEGORY_KEYWORDS[categoryKey];
  if (!keywords) return true;
  const titleLower = (product.title || '').toLowerCase();
  const matches = keywords.some(kw => titleLower.includes(kw));
  if (!matches) return false;
  const excludes = getEffectiveExcludes(categoryKey);
  if (excludes.some(ex => titleLower.includes(ex))) return false;
  return true;
}

export function getCategoryTitle(key: string, lang: string): string {
  return CATEGORY_TITLE_MAP[key]?.[lang] || CATEGORY_TITLE_MAP[key]?.en || key;
}

export function filterForCategory(items: Product[], catKey: string): Product[] {
  const excludes = getEffectiveExcludes(catKey);
  const keywords = CATEGORY_KEYWORDS[catKey];
  return items.filter(p => {
    const titleLower = (p.title || '').toLowerCase();
    if (excludes.some(ex => titleLower.includes(ex))) return false;
    if (keywords && !keywords.some(kw => titleLower.includes(kw))) return false;
    return true;
  });
}

export const LUXURY_KEYWORDS = ['pro', 'max', 'ultra', 'premium', 'oled', 'macbook', 'rolex', 'diamond', 'gold', 'luxury', 'designer', '4k', '8k', 'titanium'];

const RENEWED_KEYWORDS = ['renewed', 'refurbished', 'reconditioned', 'certified pre-owned'];
const JUNK_KEYWORDS = ['for parts', 'for repair', 'cracked', 'as-is', 'as is', 'read description', 'broken', 'damaged'];

function getSmartScore(p: Product): number {
  const title = (p.title || '').toLowerCase();
  const price = p.priceUsd || 0;

  // Filter junk items to bottom
  if (JUNK_KEYWORDS.some(kw => title.includes(kw))) return -1000;

  let score = 0;

  // Luxury keyword bonus
  if (LUXURY_KEYWORDS.some(kw => title.includes(kw))) score += 100;

  // Renewed/refurbished bonus — prefer affordable quality
  if (RENEWED_KEYWORDS.some(kw => title.includes(kw))) score += 50;

  // Price sweet spot: $500–$1,500 gets a boost over $1,500+
  if (price >= 500 && price <= 1500) score += 30;
  else if (price > 1500) score += 10;
  else if (price > 50) score += 15;

  // Tiebreaker: moderate price over extreme price
  score += Math.min(price, 1500) / 100;

  return score;
}

export function sortByLuxury(items: Product[]): Product[] {
  return [...items].sort((a, b) => getSmartScore(b) - getSmartScore(a));
}

// All homepage categories in display order
// REMOVED (per business decision): clothing, home_garden, toys, sporting_goods, parts_accessories
// Clothing will return later sourced from Turkey/China.
export const ALL_HOMEPAGE_CATEGORIES = [
  'phones', 'electronics', 'audio_music', 'gaming',
  'vehicles', 'jewelry_watches', 'refurbished', 'cameras_photo',
];
export const PROMO_CATEGORIES = ALL_HOMEPAGE_CATEGORIES.slice(0, 4);

export const PROVIDER_DISPLAY: Record<string, string> = {
  rainforest: 'Amazon', amazon: 'Amazon', ebay: 'eBay', shein: 'SHEIN',
  carvana: 'Carvana', cargurus: 'CarGurus', walmart: 'Walmart',
  bestbuy: 'Best Buy', macys: "Macy's", homedepot: 'Home Depot',
  wayfair: 'Wayfair', temu: 'Temu', ford: 'Ford', toyota: 'Toyota', tesla: 'Tesla',
};

export const COMING_SOON_STORES: string[] = [];

export const CATEGORY_FILTER_OPTIONS = [
  { value: 'all', labelEn: 'All Categories', labelFr: 'Toutes catégories' },
  { value: 'phones', labelEn: 'Phones', labelFr: 'Téléphones' },
  { value: 'vehicles', labelEn: 'Vehicles', labelFr: 'Véhicules' },
  { value: 'clothing', labelEn: 'Clothes / Fashion', labelFr: 'Mode / Vêtements' },
  { value: 'computers', labelEn: 'Computers / Laptops', labelFr: 'Ordinateurs / Laptops' },
];

export const CONCURRENCY_LIMIT = 4;
export const CURATED_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export const MODE_OVERRIDE_QUERIES = [
  'women long maxi dress elegant',
  'mens jacket coat fashion',
  'abaya kaftan dress women',
  'blazer suit women professional',
  'hoodie sweatshirt men',
  'handbag designer leather',
  'jeans denim pants',
  'robe longue femme',
  'veste homme',
  'sac à main cuir',
];

/** Deduplicate products by ID */
export function deduplicateProducts(items: Product[]): Product[] {
  const seen = new Set<string>();
  return items.filter(p => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

/** Run async tasks with a concurrency limit */
export async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.allSettled(workers);
  return results;
}
