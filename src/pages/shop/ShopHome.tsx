import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { prefetchCatalogCategory } from '@/lib/catalogCache';
import { Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { SectionBlock } from '@/components/shop/SectionBlock';
import { HeroBannerCarousel } from '@/components/shop/HeroBannerCarousel';
import { CategoryIconsRow } from '@/components/shop/CategoryIconsRow';
import { ShopFooter } from '@/components/shop/ShopFooter';
import { HorizontalProductRow } from '@/components/shop/HorizontalProductRow';
import { Product } from '@/components/shop/ProductCard';
import { Button } from '@/components/ui/button';
import { cachedCatalogFetch } from '@/lib/catalogCache';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { translations } from '@/lib/i18n/translations';
import { getRecentlyViewed } from '@/lib/recentlyViewed';

const CATEGORY_TITLE_MAP: Record<string, Record<string, string>> = {
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

// Fallback search queries for categories that lack dedicated backend recipes
const CATEGORY_SEARCH_QUERIES: Record<string, string[]> = {
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

const CATEGORY_KEYWORDS: Record<string, string[]> = {
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

// ===== GLOBAL HARD EXCLUDES — applied to ALL categories except the owner =====
const GLOBAL_SHOE_TERMS = ['shoe', 'shoes', 'sneaker', 'sneakers', 'boot', 'boots', 'nike', 'jordan', 'air max', 'yeezy', 'adidas', 'puma', 'new balance', 'reebok', 'converse', 'vans', 'timberland', 'skechers', 'asics', 'dunk low', 'dunk high', 'air force 1', 'loafer', 'sandal'];
const GLOBAL_WATCH_JEWELRY_TERMS = ['watch', 'smartwatch', 'apple watch', 'rolex', 'omega', 'cartier', 'seiko', 'casio', 'fossil', 'montre', 'necklace', 'pendant', 'ring', 'bracelet', 'earring', 'diamond', 'gold chain', 'jewelry', 'bijou'];
const GLOBAL_TOY_TERMS = ['toy', 'toys', 'lego', 'puzzle', 'doll', 'action figure', 'barbie', 'building set', 'playset', 'jouet', 'nerf', 'plush', 'stuffed animal', 'hot wheels', 'play-doh'];

// Categories that OWN each global group (exempt from those excludes)
const SHOE_OWNER_CATS = new Set(['shoes_sneakers', 'sporting_goods', 'clothing']);
const WATCH_JEWELRY_OWNER_CATS = new Set(['jewelry_watches']);
const TOY_OWNER_CATS = new Set(['toys', 'collectibles']);

const CATEGORY_EXCLUDE_KEYWORDS: Record<string, string[]> = {
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
  audio_music: ['ps5', 'playstation', 'xbox', 'nintendo', 'console', 'controller', 'game disc', 'gaming chair', 'cooling fan', 'video game', 'case', 'cover', 'protector', 'screen protector', 'tempered glass', 'mount', 'holder', 'stand', 'adapter', 'replacement', 'spare', 'repair', 'car gps', 'carplay', 'android auto', 'dash cam', 'phone case', 'sofa', 'bed', 'mattress', 'furniture', 'dress', 'shirt', 'brake pad', 'oil filter', 'perfume', 'cologne', 'makeup', 'phone', 'iphone', 'samsung', 'laptop', 'tablet', 'camera', 'lens'],
  shoes_sneakers: ['iphone', 'ps5', 'macbook', 'laptop', 'tablet', 'sofa', 'bed', 'mattress', 'phone case', 'charger', 'cable', 'lego', 'toy', 'car part', 'brake pad', 'console', 'gaming', 'perfume', 'cologne'],
  cameras_photo: ['sofa', 'bed', 'mattress', 'phone case', 'dress', 'shirt', 'lego', 'car part', 'charger cable', 'ps5', 'playstation', 'xbox', 'console', 'brake pad', 'oil filter', 'perfume', 'cologne', 'carplay', 'stereo', 'makeup', 'iphone', 'samsung galaxy', 'laptop', 'macbook', 'gaming', 'alienware', 'msi', 'dell', 'lenovo', 'asus', 'acer', 'hp pavilion', 'tablet', 'ipad', 'android', 'smartphone', 'phone', 'cellphone'],
  refurbished: [],
};

// Build effective excludes: category-specific + global excludes (shoes/watches/toys) unless owner
function getEffectiveExcludes(catKey: string): string[] {
  const base = CATEGORY_EXCLUDE_KEYWORDS[catKey] || [];
  const extras: string[] = [];
  if (!SHOE_OWNER_CATS.has(catKey)) extras.push(...GLOBAL_SHOE_TERMS);
  if (!WATCH_JEWELRY_OWNER_CATS.has(catKey)) extras.push(...GLOBAL_WATCH_JEWELRY_TERMS);
  if (!TOY_OWNER_CATS.has(catKey)) extras.push(...GLOBAL_TOY_TERMS);
  return [...new Set([...base, ...extras])];
}

function isRelevantToCategory(product: Product, categoryKey: string): boolean {
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

function getCategoryTitle(key: string, lang: string): string {
  return CATEGORY_TITLE_MAP[key]?.[lang] || CATEGORY_TITLE_MAP[key]?.en || key;
}

interface HomeFeedResponse {
  ok: boolean;
  sections: Array<{
    key: string;
    title: string;
    hideTitle?: boolean;
    items: Array<{
      id?: string;
      provider_product_id?: string;
      provider?: string;
      title?: string;
      image_url?: string;
      imageUrl?: string;
      price_usd?: number;
      priceUsd?: number;
      rating?: number;
      in_stock?: boolean;
      product_url?: string;
    }>;
  }>;
  page?: number;
  pageSize?: number;
  totalItems?: number;
  hasMore?: boolean;
  totalPages?: number;
  _meta?: { source?: string; poolSize?: number; isStale?: boolean };
}

// All homepage categories in display order
const ALL_HOMEPAGE_CATEGORIES = [
  'phones', 'electronics', 'audio_music', 'gaming',
  'vehicles', 'home_garden', 'toys', 'sporting_goods',
  'jewelry_watches', 'parts_accessories', 'refurbished',
  'clothing', 'cameras_photo',
];
const PROMO_CATEGORIES = ALL_HOMEPAGE_CATEGORIES.slice(0, 4);

const LUXURY_KEYWORDS = ['pro', 'max', 'ultra', 'premium', 'oled', 'macbook', 'rolex', 'diamond', 'gold', 'luxury', 'designer', '4k', '8k', 'titanium'];
const CONCURRENCY_LIMIT = 4;
const CURATED_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const SLOW_CATEGORIES = new Set(['vehicles', 'parts_accessories', 'jewelry_watches', 'clothing']);

function getCachedCategoryResult(catKey: string): Product[] | null {
  try {
    const raw = localStorage.getItem(`afrishop_curated:${catKey}`);
    if (!raw) return null;
    const { items, ts } = JSON.parse(raw);
    if (Date.now() - ts > CURATED_CACHE_TTL_MS) return null;
    if (!Array.isArray(items) || items.length === 0) return null;
    return items;
  } catch { return null; }
}

function setCachedCategoryResult(catKey: string, items: Product[]) {
  try {
    if (items.length > 0) {
      localStorage.setItem(`afrishop_curated:${catKey}`, JSON.stringify({ items, ts: Date.now() }));
    }
  } catch { /* quota exceeded, ignore */ }
}

// ====== HELPERS ======

const mapItemToProduct = (item: HomeFeedResponse['sections'][0]['items'][0]): Product => ({
  id: item.provider_product_id || item.id || '',
  provider: item.provider || 'amazon',
  title: item.title || 'Product',
  imageUrl: item.image_url || item.imageUrl || '',
  priceUsd: item.price_usd || item.priceUsd || 0,
  rating: item.rating,
  inStock: item.in_stock !== false,
  productUrl: item.product_url,
});

const parsePrice = (item: any): number => {
  const candidates = [
    item.priceUsd, item.price_usd, item.price,
    item.sellingStatus?.currentPrice?.value,
    item.offer?.price, item.offers?.[0]?.price,
  ];
  for (const v of candidates) {
    if (v == null) continue;
    if (typeof v === 'number' && v > 0) return v;
    if (typeof v === 'string') {
      const n = parseFloat(v.replace(/[$,]/g, ''));
      if (!isNaN(n) && n > 0) return n;
    }
  }
  return 0;
};

const mapSearchItemToProduct = (item: any): Product => ({
  id: item.id || item.providerProductId || item.provider_product_id || item.itemId || item.asin || item.productUrl || item.product_url || item.url || '',
  provider: item.provider === 'rainforest' ? 'amazon' : (item.provider || 'amazon'),
  title: item.title || 'Product',
  imageUrl: item.imageUrl || item.mainImageUrl || item.image_url || item.image || '',
  priceUsd: parsePrice(item),
  rating: item.rating,
  inStock: item.inStock !== false,
  productUrl: item.productUrl || item.product_url || item.url,
});

const isValidProduct = (p: Product) => p.id && p.priceUsd > 0 && p.imageUrl;

/** Run async tasks with a concurrency limit */
async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
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

/** Deduplicate products by ID within a list */
function deduplicateProducts(items: Product[]): Product[] {
  const seen = new Set<string>();
  return items.filter(p => {
    const key = p.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Filter products by category relevance */
function filterForCategory(items: Product[], catKey: string): Product[] {
  const excludes = getEffectiveExcludes(catKey);
  const keywords = CATEGORY_KEYWORDS[catKey];
  return items.filter(p => {
    const titleLower = (p.title || '').toLowerCase();
    if (excludes.some(ex => titleLower.includes(ex))) return false;
    // For strict categories, require keyword match
    if (keywords && !keywords.some(kw => titleLower.includes(kw))) return false;
    return true;
  });
}

/** Sort by luxury/price */
function sortByLuxury(items: Product[]): Product[] {
  return [...items].sort((a, b) => {
    const aLux = LUXURY_KEYWORDS.some(kw => (a.title || '').toLowerCase().includes(kw)) ? 1 : 0;
    const bLux = LUXURY_KEYWORDS.some(kw => (b.title || '').toLowerCase().includes(kw)) ? 1 : 0;
    if (bLux !== aLux) return bLux - aLux;
    return (b.priceUsd || 0) - (a.priceUsd || 0);
  });
}

export default function ShopHome() {
  const { language } = useLanguage();
  const { user } = useAuth();

  const t = translations[language] || translations.en;
  const shop = t.shop;

  // ====== STATE ======
  // Trending: still uses shared feed
  const [accueilProducts, setAccueilProducts] = useState<Product[]>([]);
  const [accueilLoading, setAccueilLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Per-category independent items and loading states
  const [categoryItems, setCategoryItems] = useState<Record<string, Product[]>>({});
  const [categoryLoadingMap, setCategoryLoadingMap] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    ALL_HOMEPAGE_CATEGORIES.forEach(k => { init[k] = true; });
    return init;
  });

  const [recentlyViewed, setRecentlyViewed] = useState<Product[]>([]);
  const fetchedRef = useRef(false);

  // ====== ACCUEIL (trending only) ======
  const fetchAccueilFeed = useCallback(async () => {
    setAccueilLoading(true);
    setError(null);
    try {
      const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-home', {
        page: 1,
        pageSize: 100,
        client: 'web',
      });
      if (data?.sections?.length) {
        const all = data.sections.flatMap(s => s.items).map(mapItemToProduct).filter(p => p.id && p.priceUsd > 0);
        setAccueilProducts(all);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load');
    } finally {
      setAccueilLoading(false);
    }
  }, []);

  // ====== CURATED CATEGORY HELPERS ======
  const JUNK_TERMS = ['cheap', 'lot', 'bundle', 'broken', 'for repair', 'as is', 'not working'];
  const AUTO_PARTS_JUNK_TERMS = ['for parts', 'parts only', 'not working', 'broken', 'as-is', 'as is', 'read description', 'repair', 'damaged'];
  const isNotJunk = (p: Product) => !JUNK_TERMS.some(t => (p.title || '').toLowerCase().includes(t));
  const isNotAutoPartsJunk = (p: Product) => !AUTO_PARTS_JUNK_TERMS.some(t => (p.title || '').toLowerCase().includes(t));

  const looksLikeVehicle = (title: string) => {
    const t = title.toLowerCase();
    if (/\b(19|20)\d{2}\b/.test(t)) return true;
    if (/\b(miles?|mi|kms?|km)\b/.test(t)) return true;
    if (/\b(suv|sedan|coupe|awd|4wd|rwd|fwd|convertible|hatchback|wagon)\b/.test(t)) return true;
    if (/\b(vin|clean title|salvage|rebuilt)\b/.test(t)) return true;
    return false;
  };

  async function searchValidItems(queries: string[], max: number, seenIds: Set<string>, excludes?: string[]): Promise<Product[]> {
    const results: Product[] = [];
    for (const q of queries) {
      if (results.length >= max) break;
      try {
        const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 10 });
        const searchItems = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct).filter(isNotJunk);
        for (const p of searchItems) {
          if (results.length >= max) break;
          const stableKey = (p.id || '') + '|' + ((p.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40));
          if (seenIds.has(stableKey)) continue;
          if (excludes && excludes.some(ex => (p.title || '').toLowerCase().includes(ex))) continue;
          results.push(p);
          seenIds.add(stableKey);
        }
      } catch (e) { /* continue */ }
    }
    return results;
  }

  async function searchVehicles(queries: string[], max: number, seenIds: Set<string>, excludes: string[]): Promise<Product[]> {
    const results: Product[] = [];
    for (const q of queries) {
      if (results.length >= max) break;
      try {
        const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 15 });
        const raw = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct);
        console.log(`[Vehicles] query "${q}" raw:`, raw.slice(0, 5).map((x: Product) => x.title));
        for (const p of raw) {
          if (results.length >= max) break;
          const title = (p.title || '').toLowerCase();
          const stableKey = (p.id || '') + '|' + title.replace(/[^a-z0-9]/g, '').slice(0, 40);
          if (seenIds.has(stableKey)) continue;
          if (excludes.some(ex => title.includes(ex))) continue;
          if (!looksLikeVehicle(p.title || '')) continue;
          results.push(p);
          seenIds.add(stableKey);
        }
      } catch (e) { /* continue */ }
    }
    return results;
  }

  // ====== MODE (clothing) SPECIAL OVERRIDE QUERIES ======
  const MODE_OVERRIDE_QUERIES = [
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

  // ====== PER-CATEGORY INDEPENDENT FETCH ======
  const fetchAllCategoryItems = useCallback(async () => {
    const tasks = ALL_HOMEPAGE_CATEGORIES.map((catKey) => async () => {
      setCategoryLoadingMap(prev => ({ ...prev, [catKey]: true }));
      // For slow categories, show cached curated result instantly
      let backgroundRefresh = false;
      if (SLOW_CATEGORIES.has(catKey)) {
        const cached = getCachedCategoryResult(catKey);
        if (cached) {
          setCategoryItems(prev => ({ ...prev, [catKey]: cached }));
          setCategoryLoadingMap(prev => ({ ...prev, [catKey]: false }));
          backgroundRefresh = true; // still run pipeline to refresh cache silently
        }
      }

      try {
        let items: Product[] = [];

        // ===== SPECIAL PATH FOR "clothing" (Mode) =====
        if (catKey === 'clothing') {
          const seenIds = new Set<string>();
          const excludes = getEffectiveExcludes('clothing');
          for (const q of MODE_OVERRIDE_QUERIES) {
            if (items.length >= 4) break;
            try {
              const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 10 });
              const searchItems = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct);
              for (const p of searchItems) {
                if (items.length >= 4) break;
                if (seenIds.has(p.id)) continue;
                const titleLower = (p.title || '').toLowerCase();
                if (excludes.some(ex => titleLower.includes(ex))) continue;
                items.push(p);
                seenIds.add(p.id);
              }
              console.log(`[Mode] query tried: "${q}", valid so far: ${items.length}`);
            } catch (e) {
              console.warn(`[Mode] query "${q}" failed`, e);
            }
          }
          items = sortByLuxury(items).slice(0, 4);

        // ===== SPECIAL PATH FOR "vehicles" (Véhicules) =====
        // Goal: 1 Tesla luxury + 3 SUVs. Try DB-cached sources first, then live search fallback.
        } else if (catKey === 'vehicles') {
          const vehicleExcludes = [
            ...(CATEGORY_EXCLUDE_KEYWORDS['vehicles'] || []),
            'adapter', 'j1772', 'wall connector',
            'floor mat', 'seat cover', 'phone holder', 'mount',
            'keychain', 'sticker', 'decal', 'toy', 'hot wheels',
            'model car', 'diecast', 'scale model', 'matchbox',
          ];
          const isVehicleItem = (p: Product): boolean => {
            if (!p.id || !p.imageUrl) return false;
            if ((p.priceUsd || 0) < 500) return false;
            const t = (p.title || '').toLowerCase();
            if (vehicleExcludes.some(ex => t.includes(ex))) return false;
            return true;
          };
          const seenIds = new Set<string>();

          // Exact vehicle queries for the 4 luxury cars
          const EXACT_VEHICLE_QUERIES = [
            '2023 Tesla Model X Plaid Full Self Driving White',
            '2025 GMC Yukon XL AT4 Ultimate 4WD Lifted Vossens',
            '2025 Ford Explorer Active AWD SUV',
            '2025 Hyundai Santa Fe XRT Sport Utility',
          ];

          for (const q of EXACT_VEHICLE_QUERIES) {
            if (items.length >= 4) break;
            try {
              const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 5 });
              const searchItems = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct).filter(isVehicleItem);
              for (const p of searchItems) {
                if (items.length >= 4) break;
                const key = p.id + '|' + (p.title || '').slice(0, 30);
                if (seenIds.has(key)) continue;
                seenIds.add(key);
                items.push(p);
                break; // take only first valid match per query
              }
              console.log(`[Vehicles] exact query "${q}" → found ${searchItems.length} valid, total so far: ${items.length}`);
            } catch (e) {
              console.warn(`[Vehicles] exact query "${q}" failed:`, e);
            }
          }

          items = items.slice(0, 4);
          console.log('[Vehicles] selected:', items.map(p => `${p.title} ($${p.priceUsd})`));

        // ===== SPECIAL PATH FOR "jewelry_watches" (Montres & Bijoux) =====
        } else if (catKey === 'jewelry_watches') {
          const seenIds = new Set<string>();
          // Phase 1: Collect watches (aim 2+)
          const watchQueries = [
            'Rolex watch', 'Cartier watch', 'Omega watch',
            'Tag Heuer watch', 'Breitling watch', 'Tudor watch',
            'luxury watch men', 'luxury watch women',
          ];
          const watches = await searchValidItems(watchQueries, 4, seenIds);
          // Phase 2: Collect rings (aim 1+)
          const ringQueries = [
            'diamond ring', 'gold ring luxury', 'Cartier ring',
            'Tiffany ring', 'engagement ring diamond',
          ];
          const rings = await searchValidItems(ringQueries, 2, seenIds);
          // Phase 3: Optional filler
          const fillerQueries = [
            'Cartier bracelet', 'diamond bracelet',
            'luxury necklace', 'diamond necklace',
          ];

          // Assemble with mix: 2 watches + 1 ring + 1 best remaining
          const assembled: Product[] = [];
          // Add up to 2 watches
          for (const w of watches) { if (assembled.length < 2) assembled.push(w); }
          // Add at least 1 ring
          for (const r of rings) { if (assembled.length < 3) assembled.push(r); }
          // Fill remaining from leftover watches, rings, or filler
          const leftover = [...watches.slice(2), ...rings.slice(1)];
          for (const p of leftover) { if (assembled.length < 4) assembled.push(p); }
          // If still < 4, fetch filler
          if (assembled.length < 4) {
            const filler = await searchValidItems(fillerQueries, 4 - assembled.length, seenIds);
            assembled.push(...filler);
          }
          items = assembled.slice(0, 4);
          // Sort by price (highest first) for luxury feel
          items.sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0));
          console.log('[WatchesJewelry] selected:', items.map(p => p.title));

        // ===== SPECIAL PATH FOR "parts_accessories" (Pièces Auto) =====
        } else if (catKey === 'parts_accessories') {
          const seenIds = new Set<string>();
          const seenImages = new Set<string>();
          const seenTitleKeys = new Set<string>();

          const addUnique = (p: Product, bucket: Product[]) => {
            const titleKey = (p.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
            const imgKey = (p.imageUrl || '').split('?')[0];
            if (seenIds.has(p.id)) return false;
            if (titleKey && seenTitleKeys.has(titleKey)) return false;
            if (imgKey && seenImages.has(imgKey)) return false;
            seenIds.add(p.id);
            seenTitleKeys.add(titleKey);
            if (imgKey) seenImages.add(imgKey);
            bucket.push(p);
            return true;
          };

          // Use broad queries known to return auto parts results
          const AUTO_PARTS_QUERIES = [
            'brake pad rotor', 'car headlight assembly', 'alternator',
            'car battery', 'spark plug set', 'oil filter', 'air filter car',
            'wiper blade', 'car bumper', 'wheel bearing', 'serpentine belt',
            'ignition coil', 'oxygen sensor', 'power steering pump',
            'water pump car', 'strut assembly', 'tie rod end',
            'brake caliper', 'radiator', 'fuel pump',
          ];

          const partsExcludes = CATEGORY_EXCLUDE_KEYWORDS['parts_accessories'] || [];
          const isAutoPartItem = (p: Product): boolean => {
            if (!p.id || !p.imageUrl || !p.priceUsd) return false;
            const t = (p.title || '').toLowerCase();
            if (partsExcludes.some(ex => t.includes(ex))) return false;
            if (AUTO_PARTS_JUNK_TERMS.some(jt => t.includes(jt))) return false;
            return ['brake', 'rotor', 'pad', 'headlight', 'alternator', 'battery', 'spark', 'filter', 'wiper', 'bumper', 'bearing', 'belt', 'coil', 'sensor', 'steering', 'pump', 'strut', 'tie rod', 'caliper', 'radiator', 'fuel', 'exhaust', 'muffler', 'axle', 'transmission', 'clutch', 'gasket', 'suspension', 'engine', 'motor', 'turbo', 'injector', 'catalytic', 'car', 'auto', 'vehicle'].some(k => t.includes(k));
          };

          const allParts: Product[] = [];

          // Attempt 1: catalog-category (DB-cached auto parts)
          try {
            const data = await cachedCatalogFetch<any>('catalog-category', {
              category: 'parts_accessories', limit: 50, page: 1, pageSize: 50, client: 'web',
            });
            const rawItems = (data?.items || []).map((item: any) => ({
              id: item.providerProductId || item.provider_product_id || item.id || '',
              provider: item.provider || 'ebay',
              title: item.title || '',
              imageUrl: item.mainImageUrl || item.imageUrl || item.image_url || '',
              priceUsd: item.priceUsd || item.price_usd || 0,
              rating: item.rating, inStock: true,
              productUrl: item.productUrl || item.product_url || '',
            } as Product)).filter(isAutoPartItem);
            console.log('[AutoParts] catalog-category raw:', rawItems.slice(0, 5).map((p: Product) => `${p.title} ($${p.priceUsd})`));
            for (const p of rawItems) {
              if (allParts.length >= 8) break;
              addUnique(p, allParts);
            }
          } catch (e) { console.warn('[AutoParts] catalog-category failed:', e); }

          // Attempt 2: catalog-home feed (DB-cached)
          if (allParts.length < 4) {
            try {
              const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-home', {
                category: 'parts_accessories', page: 1, pageSize: 80, client: 'web',
              });
              const feedItems = (data?.sections?.flatMap(s => s.items) || [])
                .map(mapItemToProduct).filter(isValidProduct).filter(isAutoPartItem);
              console.log('[AutoParts] catalog-home raw:', feedItems.slice(0, 5).map((p: Product) => `${p.title} ($${p.priceUsd})`));
              for (const p of feedItems) {
                if (allParts.length >= 8) break;
                addUnique(p, allParts);
              }
            } catch (e) { console.warn('[AutoParts] catalog-home fallback failed:', e); }
          }

          // Attempt 3: live search fallback
          if (allParts.length < 4) {
            for (const q of AUTO_PARTS_QUERIES) {
              if (allParts.length >= 8) break;
              try {
                const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 10 });
                const raw = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct).filter(isNotAutoPartsJunk);
                console.log(`[AutoParts] search "${q}" raw:`, raw.slice(0, 3).map((x: Product) => x.title));
                for (const p of raw) {
                  if (allParts.length >= 8) break;
                  const t = (p.title || '').toLowerCase();
                  const looksAutoPart = ['brake', 'rotor', 'pad', 'headlight', 'alternator', 'battery', 'spark', 'filter', 'wiper', 'bumper', 'bearing', 'belt', 'coil', 'sensor', 'steering', 'pump', 'strut', 'tie rod', 'caliper', 'radiator', 'fuel', 'exhaust', 'muffler', 'axle', 'transmission', 'clutch', 'gasket', 'suspension', 'engine', 'motor', 'turbo', 'injector', 'catalytic', 'car', 'auto', 'vehicle'].some(k => t.includes(k));
                  if (looksAutoPart) addUnique(p, allParts);
                }
              } catch (e) { /* continue */ }
            }
          }

          // Sort by price descending to prefer substantial parts
          allParts.sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0));
          items = allParts.slice(0, 4);
          console.log('[AutoParts] selected titles:', items.map(p => `${p.title} ($${p.priceUsd})`));

        // ===== SPECIAL PATH FOR "cameras_photo" =====
        } else if (catKey === 'cameras_photo') {
          const cameraExcludes = CATEGORY_EXCLUDE_KEYWORDS['cameras_photo'] || [];
          const cameraKeywords = CATEGORY_KEYWORDS['cameras_photo'] || [];
          const seenIds = new Set<string>();

          const isCameraItem = (p: Product): boolean => {
            if (!p.id || !p.imageUrl || !p.priceUsd) return false;
            const t = (p.title || '').toLowerCase();
            if (cameraExcludes.some(ex => t.includes(ex))) return false;
            return cameraKeywords.some(kw => t.includes(kw));
          };

          const addUniqueCamera = (p: Product, bucket: Product[]): boolean => {
            if (seenIds.has(p.id)) return false;
            seenIds.add(p.id);
            bucket.push(p);
            return true;
          };

          const allCameras: Product[] = [];

          // Attempt 1: catalog-category (DB-cached camera items)
          try {
            const data = await cachedCatalogFetch<any>('catalog-category', {
              category: 'cameras_photo', limit: 50, page: 1, pageSize: 50, client: 'web',
            });
            const rawItems = (data?.items || []).map((item: any) => ({
              id: item.providerProductId || item.provider_product_id || item.id || '',
              provider: item.provider || 'ebay',
              title: item.title || '',
              imageUrl: item.mainImageUrl || item.imageUrl || item.image_url || '',
              priceUsd: item.priceUsd || item.price_usd || 0,
              rating: item.rating, inStock: true,
              productUrl: item.productUrl || item.product_url || '',
            } as Product)).filter(isCameraItem);
            for (const p of rawItems) {
              if (allCameras.length >= 8) break;
              addUniqueCamera(p, allCameras);
            }
          } catch (e) { console.warn('[Cameras] catalog-category failed:', e); }

          // Attempt 2: catalog-home feed
          if (allCameras.length < 4) {
            try {
              const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-home', {
                category: 'cameras_photo', page: 1, pageSize: 80, client: 'web',
              });
              const feedItems = (data?.sections?.flatMap(s => s.items) || [])
                .map(mapItemToProduct).filter(isValidProduct).filter(isCameraItem);
              for (const p of feedItems) {
                if (allCameras.length >= 8) break;
                addUniqueCamera(p, allCameras);
              }
            } catch (e) { console.warn('[Cameras] catalog-home failed:', e); }
          }

          // Attempt 3: broad search queries
          if (allCameras.length < 4) {
            const CAMERA_QUERIES = [
              'DSLR camera', 'mirrorless camera Sony Canon Nikon',
              'GoPro action camera', 'camera lens', 'digital camera',
              'camera tripod', 'Nikon camera', 'Fujifilm camera',
            ];
            for (const q of CAMERA_QUERIES) {
              if (allCameras.length >= 8) break;
              try {
                const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 15 });
                const raw = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct).filter(isCameraItem);
                for (const p of raw) {
                  if (allCameras.length >= 8) break;
                  addUniqueCamera(p, allCameras);
                }
              } catch (e) { /* continue */ }
            }
          }

          allCameras.sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0));
          items = allCameras.slice(0, 4);
          console.log('[Cameras] selected:', items.map(p => `${p.title?.slice(0, 40)} ($${p.priceUsd})`));

        } else {
          // ===== STANDARD PATH FOR ALL OTHER CATEGORIES =====
          // Stage 1: Try dedicated category feed
          try {
            const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-home', {
              category: catKey,
              page: 1,
              pageSize: 80,
              client: 'web',
            });
            const rawItems = (data?.sections?.flatMap(s => s.items) || []).map(mapItemToProduct).filter(isValidProduct);
            items = filterForCategory(rawItems, catKey);
          } catch (e) {
            // Ignore, proceed to search fallback
          }

          // Stage 2: If not enough, try search queries
          if (items.length < 4) {
            const queries = CATEGORY_SEARCH_QUERIES[catKey] || [catKey.replace('_', ' ')];
            for (const q of queries.slice(0, 4)) {
              if (items.length >= 8) break;
              try {
                const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 8 });
                const searchItems = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct);
                items.push(...searchItems);
              } catch (e) {
                // Continue with next query
              }
            }
            items = filterForCategory(items, catKey);
          }

          // Deduplicate and take first 4
          items = deduplicateProducts(sortByLuxury(items)).slice(0, 4);
        }

        console.log(`[ShopHome] Category ${catKey}: fetched=${items.length}, shown=${Math.min(items.length, 4)}`);

        // Cache curated result for slow categories
        if (SLOW_CATEGORIES.has(catKey)) {
          setCachedCategoryResult(catKey, items);
        }

        // Only update UI if we got results (don't blank out cached display with empty)
        if (items.length > 0 || !backgroundRefresh) {
          setCategoryItems(prev => ({ ...prev, [catKey]: items }));
        }
      } catch (err) {
        console.warn(`[ShopHome] Category ${catKey} fetch failed:`, err);
        if (!backgroundRefresh) {
          setCategoryItems(prev => ({ ...prev, [catKey]: [] }));
        }
      } finally {
        if (!backgroundRefresh) {
          setCategoryLoadingMap(prev => ({ ...prev, [catKey]: false }));
        }
      }
    });

    await runWithConcurrency(tasks, CONCURRENCY_LIMIT);
  }, []);

  const loadRecentlyViewed = useCallback(async () => {
    try {
      const items = await getRecentlyViewed(user?.id, 12);
      setRecentlyViewed(items);
    } catch (err) {
      console.warn('[ShopHome] recently viewed fetch failed', err);
    }
  }, [user?.id]);

  // ====== TRENDING FEED (from shared accueil pool) ======
  const trendingFeed = useMemo(() => {
    const dedup = new Set<string>();
    const trendingCats = ['phones', 'electronics', 'vehicles', 'jewelry_watches', 'gaming', 'audio_music', 'cameras_photo', 'home_garden', 'sporting_goods', 'toys', 'parts_accessories', 'refurbished', 'collectibles'];
    const trending: Product[] = [];

    // Round-robin from accueil products by category
    for (const cat of trendingCats) {
      const relevant = accueilProducts.filter(p => isRelevantToCategory(p, cat));
      const sorted = sortByLuxury(relevant);
      let count = 0;
      for (const p of sorted) {
        if (count >= 2) break;
        if (!dedup.has(p.id)) {
          trending.push(p);
          dedup.add(p.id);
          count++;
        }
      }
    }

    // Backfill
    if (trending.length < 16) {
      for (const p of sortByLuxury(accueilProducts)) {
        if (trending.length >= 16) break;
        if (!dedup.has(p.id) && (p.priceUsd || 0) > 0) {
          trending.push(p);
          dedup.add(p.id);
        }
      }
    }

    return trending.slice(0, 16);
  }, [accueilProducts]);

  // ====== EFFECTS ======
  // Idle prefetch: warm category caches after homepage loads
  const scheduleCategoryPrefetch = useCallback(() => {
    const schedule = typeof requestIdleCallback === 'function'
      ? requestIdleCallback
      : (cb: () => void) => setTimeout(cb, 3000);

    schedule(() => {
      ALL_HOMEPAGE_CATEGORIES.forEach((catKey, i) => {
        setTimeout(() => {
          prefetchCatalogCategory(catKey, language);
        }, i * 500); // stagger 500ms apart
      });
    });
  }, [language]);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetchAccueilFeed();
    fetchAllCategoryItems().then(scheduleCategoryPrefetch);
    loadRecentlyViewed();
  }, []);

  // Re-fetch on language change
  useEffect(() => {
    if (!fetchedRef.current) return;
    fetchAccueilFeed();
    fetchAllCategoryItems();
  }, [language]);

  useEffect(() => {
    loadRecentlyViewed();
  }, [user?.id]);

  const isInitialLoading = accueilLoading && Object.values(categoryLoadingMap).every(v => v);

  return (
    <div className="min-h-screen bg-[#0f1115] pb-20 md:pb-0">
      <ShopHeader />
      <div className="pt-16 md:pt-20" />

      {/* 1) Hero Banner Carousel */}
      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }} className="mb-5">
        <HeroBannerCarousel />
      </motion.section>

      <main className="pb-8">
        <div className="container mx-auto px-3 sm:px-4">
          {isInitialLoading ? (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <SectionBlock key={i} items={[]} loading mode="grid" />
                ))}
              </div>
              <SectionBlock items={[]} loading />
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <p className="text-red-400 mb-4">{error}</p>
              <Button onClick={() => fetchAccueilFeed()} variant="outline" className="border-white/20 text-white/90 hover:bg-white/10">
                {shop.tryAgain}
              </Button>
            </div>
          ) : (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="space-y-6">

              {/* 2) Trending Grid — 16 diverse luxury items */}
              {trendingFeed.length > 0 && (
                <SectionBlock
                  title={language === 'fr' ? 'Tendances' : 'Trending Now'}
                  items={trendingFeed}
                  mode="static-grid"
                  seeAllLink="/category/all"
                />
              )}

              {/* 3) Promo Tiles — top 4 categories */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {PROMO_CATEGORIES.map(catKey => (
                  <SectionBlock
                    key={catKey}
                    title={getCategoryTitle(catKey, language)}
                    items={categoryItems[catKey] ?? []}
                    loading={categoryLoadingMap[catKey] === true}
                    mode="grid"
                    categoryKey={catKey}
                  />
                ))}
              </div>

              {/* 4) Recently Viewed */}
              {recentlyViewed.length > 0 && (
                <div className="bg-[#1a1d23] border border-white/[0.08] rounded-2xl p-3 sm:p-4 shadow-md">
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <Clock className="h-4 w-4 text-white/60" />
                    <h2 className="text-lg font-semibold text-white/90">
                      {language === 'fr' ? 'Vus récemment' : 'Recently Viewed'}
                    </h2>
                  </div>
                  <HorizontalProductRow products={recentlyViewed} />
                </div>
              )}

              {/* 5) Remaining Category Grid Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {ALL_HOMEPAGE_CATEGORIES.filter(k => !PROMO_CATEGORIES.includes(k)).map(catKey => (
                  <SectionBlock
                    key={catKey}
                    title={getCategoryTitle(catKey, language)}
                    items={categoryItems[catKey] ?? []}
                    loading={categoryLoadingMap[catKey] === true}
                    mode="grid"
                    categoryKey={catKey}
                  />
                ))}
              </div>

              {/* 6) Category Icons Row */}
              <CategoryIconsRow />
            </motion.div>
          )}
        </div>
      </main>

      <ShopFooter />
      <BottomNavigation />
    </div>
  );
}
