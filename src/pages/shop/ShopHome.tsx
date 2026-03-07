import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { prefetchCatalogCategory } from '@/lib/catalogCache';
import { Clock, Loader2, Link2, ArrowRight } from 'lucide-react';
import { LazySection } from '@/components/shop/LazySection';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { SectionBlock } from '@/components/shop/SectionBlock';
import { HeroBannerCarousel } from '@/components/shop/HeroBannerCarousel';
import { CategoryIconsRow } from '@/components/shop/CategoryIconsRow';
import { ShopFooter } from '@/components/shop/ShopFooter';
import { HorizontalProductRow } from '@/components/shop/HorizontalProductRow';
import { Product } from '@/components/shop/ProductCard';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cachedCatalogFetch } from '@/lib/catalogCache';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { translations } from '@/lib/i18n/translations';
import { getRecentlyViewed } from '@/lib/recentlyViewed';
import { isRenderableImageUrl } from '@/lib/imageValidation';
import { supabase } from '@/integrations/supabase/client';

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

const CATEGORY_KEYWORDS: Record<string, string[]> = {
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
  audio_music: ['ps5', 'playstation', 'xbox', 'nintendo', 'console', 'controller', 'game disc', 'gaming chair', 'cooling fan', 'video game', 'case', 'cover', 'protector', 'screen protector', 'tempered glass', 'mount', 'holder', 'stand', 'adapter', 'replacement', 'spare', 'repair', 'car gps', 'carplay', 'android auto', 'dash cam', 'phone case', 'sofa', 'bed', 'mattress', 'furniture', 'dress', 'shirt', 'brake pad', 'oil filter', 'perfume', 'cologne', 'makeup', 'phone', 'iphone', 'samsung', 'laptop', 'tablet', 'camera', 'lens', 'kindle', 'e-reader', 'ebook', 'paperwhite', 'reader'],
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
const SLOW_CATEGORIES = new Set(ALL_HOMEPAGE_CATEGORIES);

function getCachedCategoryResult(catKey: string): Product[] | null {
  try {
    const raw = localStorage.getItem(`afrishop_curated_v2:${catKey}`);
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
      localStorage.setItem(`afrishop_curated_v2:${catKey}`, JSON.stringify({ items, ts: Date.now() }));
    }
  } catch { /* quota exceeded, ignore */ }
}

// ====== HELPERS ======

const mapItemToProduct = (item: HomeFeedResponse['sections'][0]['items'][0]): Product => {
  const rawImage = item.image_url || item.imageUrl || '';
  return {
    id: item.provider_product_id || item.id || '',
    provider: item.provider || 'amazon',
    title: item.title || 'Product',
    imageUrl: isRenderableImageUrl(rawImage) ? rawImage : '',
    priceUsd: item.price_usd || item.priceUsd || 0,
    rating: item.rating,
    inStock: item.in_stock !== false,
    productUrl: item.product_url,
  };
};

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

const mapSearchItemToProduct = (item: any): Product => {
  const rawImage = item.imageUrl || item.mainImageUrl || item.image_url || item.image || '';
  return {
    id: item.id || item.providerProductId || item.provider_product_id || item.itemId || item.asin || item.productUrl || item.product_url || item.url || '',
    provider: item.provider === 'rainforest' ? 'amazon' : (item.provider || 'amazon'),
    title: item.title || 'Product',
    imageUrl: isRenderableImageUrl(rawImage) ? rawImage : '',
    priceUsd: parsePrice(item),
    rating: item.rating,
    inStock: item.inStock !== false,
    productUrl: item.productUrl || item.product_url || item.url,
  };
};

const isValidProduct = (p: Product) => p.id && p.priceUsd > 0 && (p.imageUrl ? isRenderableImageUrl(p.imageUrl) : true);


const extractFirstImageFromJson = (images: any): string | null => {
  const readCandidates = (obj: any): string[] => {
    if (!obj || typeof obj !== 'object') return [];
    return [obj.url, obj.image, obj.src, obj.large, obj.hiRes, obj.hi_res, obj.main].filter((v): v is string => typeof v === 'string');
  };

  if (Array.isArray(images)) {
    for (const img of images) {
      if (typeof img === 'string' && isRenderableImageUrl(img)) return img;
      for (const candidate of readCandidates(img)) {
        if (isRenderableImageUrl(candidate)) return candidate;
      }
    }
    return null;
  }

  if (images && typeof images === 'object') {
    for (const candidate of readCandidates(images)) {
      if (isRenderableImageUrl(candidate)) return candidate;
    }
  }

  return null;
};

const deriveProviderImageFallback = (provider: string, providerProductId?: string | null): string | null => {
  if (!providerProductId) return null;
  const p = provider.toLowerCase();
  if (p === 'carvana') {
    return `https://vexgateway.fastly.carvana.io/${providerProductId}/standardizedHero.jpg?width=800`;
  }
  // Removed broken SHEIN CDN fallback - the fabricated URL pattern doesn't resolve
  return null;
};

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
  const [providerFilter, setProviderFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const fetchedRef = useRef(false);
  const [dynamicStores, setDynamicStores] = useState<{ value: string; label: string; count: number }[]>([]);

  // Store-filtered products (flat grid from DB)
  const [storeProducts, setStoreProducts] = useState<Product[]>([]);
  const [storeProductsLoading, setStoreProductsLoading] = useState(false);
  const [storeTotalCount, setStoreTotalCount] = useState(0);
  const [storeProductsPage, setStoreProductsPage] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  // Category-only filtered products (flat grid from DB, no store filter)
  const [categoryProducts, setCategoryProducts] = useState<Product[]>([]);
  const [categoryProductsLoading, setCategoryProductsLoading] = useState(false);
  const [categoryTotalCount, setCategoryTotalCount] = useState(0);
  const [categoryProductsPage, setCategoryProductsPage] = useState(0);
  const [categoryLoadingMore, setCategoryLoadingMore] = useState(false);
  const categoryProductsCacheRef = useRef<Record<string, { products: Product[]; count: number }>>({});

  // Cache store-filtered results per provider for instant re-display
  const storeProductsCacheRef = useRef<Record<string, { products: Product[]; count: number }>>({});

  const PROVIDER_DISPLAY: Record<string, string> = {
    rainforest: 'Amazon', amazon: 'Amazon', ebay: 'eBay', shein: 'SHEIN',
    carvana: 'Carvana', cargurus: 'CarGurus', walmart: 'Walmart',
    bestbuy: 'Best Buy', macys: "Macy's", homedepot: 'Home Depot',
    wayfair: 'Wayfair', temu: 'Temu', ford: 'Ford', toyota: 'Toyota', tesla: 'Tesla',
  };

  // Popular stores to always show even if they have 0 products yet
  const COMING_SOON_STORES = ['walmart', 'bestbuy', 'macys', 'homedepot', 'wayfair', 'temu', 'ford', 'toyota', 'tesla'];

  // Category filter options
  const CATEGORY_FILTER_OPTIONS = [
    { value: 'all', labelEn: 'All Categories', labelFr: 'Toutes catégories' },
    { value: 'phones', labelEn: 'Phones', labelFr: 'Téléphones' },
    { value: 'vehicles', labelEn: 'Vehicles', labelFr: 'Véhicules' },
    { value: 'clothing', labelEn: 'Clothes / Fashion', labelFr: 'Mode / Vêtements' },
    { value: 'computers', labelEn: 'Computers / Laptops', labelFr: 'Ordinateurs / Laptops' },
  ];

  // Fetch distinct providers via RPC for dynamic store dropdown
  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.rpc('get_active_providers');
        if (error) throw error;
        if (!data) return;
        // Merge rainforest+amazon counts
        const mergedMap = new Map<string, number>();
        for (const row of data as { provider: string; item_count: number }[]) {
          const key = row.provider === 'rainforest' ? 'amazon' : row.provider;
          mergedMap.set(key, (mergedMap.get(key) || 0) + Number(row.item_count));
        }
        const stores = Array.from(mergedMap.entries())
          .filter(([p]) => p && p !== '')
          .map(([p, count]) => ({
            value: p,
            label: PROVIDER_DISPLAY[p] || p.charAt(0).toUpperCase() + p.slice(1),
            count,
          }))
          .sort((a, b) => b.count - a.count);

        // Add coming-soon stores that aren't already in the list
        const existingKeys = new Set(stores.map(s => s.value));
        for (const storeKey of COMING_SOON_STORES) {
          if (!existingKeys.has(storeKey)) {
            stores.push({
              value: storeKey,
              label: PROVIDER_DISPLAY[storeKey] || storeKey.charAt(0).toUpperCase() + storeKey.slice(1),
              count: 0,
            });
          }
        }

        setDynamicStores(stores);
      } catch (e) { console.warn('[ShopHome] Failed to fetch providers:', e); }
    })();
  }, []);

  // Fetch products for a specific store from the DB (paginated)
  const fetchStorePage = useCallback(async (provider: string, page: number, append: boolean) => {
    const providerKeys = provider === 'amazon' ? ['rainforest', 'amazon'] : [provider];
    const PAGE_SIZE = 200;
    const from = page * PAGE_SIZE;

    if (!append) setStoreProductsLoading(true);
    else setLoadingMore(true);

    try {
      const { data, error, count } = await supabase
        .from('catalog_items')
        .select(
          'id, provider, provider_product_id, title, image_url, images, product_url, price_usd, rating, in_stock',
          { count: 'exact' }
        )
        .in('provider', providerKeys)
        .eq('is_active', true)
        .eq('is_disallowed', false)
        .gt('price_usd', 0)
        .order('first_seen_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;

      const totalCount = count ?? 0;
      const mapped = (data || [])
        .map((item: any): Product | null => {
          const fallbackImage = extractFirstImageFromJson(item.images);
          const providerFallback = deriveProviderImageFallback(item.provider || provider, item.provider_product_id || item.id);
          const preferred = isRenderableImageUrl(item.image_url)
            ? item.image_url
            : (fallbackImage || providerFallback);
          if (!preferred || !isRenderableImageUrl(preferred)) return null;
          return {
            id: item.provider_product_id || item.id,
            provider: item.provider || provider,
            title: item.title || 'Product',
            imageUrl: preferred,
            priceUsd: item.price_usd || 0,
            rating: item.rating,
            inStock: item.in_stock !== false,
            productUrl: item.product_url,
          };
        })
        .filter((p): p is Product => p !== null);

      if (append) {
        setStoreProducts(prev => {
          const combined = [...prev, ...mapped];
          storeProductsCacheRef.current[provider] = { products: combined, count: totalCount };
          return combined;
        });
      } else {
        setStoreProducts(mapped);
        storeProductsCacheRef.current[provider] = { products: mapped, count: totalCount };
      }
      setStoreTotalCount(totalCount);
    } catch (err) {
      console.warn(`[ShopHome] Store fetch for ${provider} page ${page} failed:`, err);
    } finally {
      setStoreProductsLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (!providerFilter || providerFilter === 'all') {
      setStoreProducts([]);
      setStoreTotalCount(0);
      setStoreProductsPage(0);
      return;
    }

    // Instant display from cache if available
    const cached = storeProductsCacheRef.current[providerFilter];
    if (cached) {
      setStoreProducts(cached.products);
      setStoreTotalCount(cached.count);
      return;
    }

    setStoreProductsPage(0);
    fetchStorePage(providerFilter, 0, false);
  }, [providerFilter, fetchStorePage]);

  const handleLoadMore = useCallback(() => {
    const nextPage = storeProductsPage + 1;
    setStoreProductsPage(nextPage);
    fetchStorePage(providerFilter, nextPage, true);
  }, [storeProductsPage, providerFilter, fetchStorePage]);

  // Fetch category-only products using fast backend category endpoint (avoids DB timeout on large OR scans)
  const fetchCategoryPage = useCallback(async (catKey: string, page: number, append: boolean) => {
    const PAGE_SIZE = 200;

    if (!append) setCategoryProductsLoading(true);
    else setCategoryLoadingMore(true);

    try {
      const endpointCategory = catKey === 'computers' ? 'electronics' : catKey;
      let mapped: Product[] = [];
      let totalCount = 0;

      try {
        const data = await cachedCatalogFetch<any>('catalog-category', {
          category: endpointCategory,
          page: page + 1,
          pageSize: PAGE_SIZE,
          client: 'web',
          language,
        });

        const rawItems = data?.items || data?.sections?.[0]?.items || [];
        totalCount = Number(data?.total || 0);

        mapped = rawItems
          .map((item: any) => mapItemToProduct(item))
          .filter(isValidProduct)
          .filter(p => isRelevantToCategory(p, catKey));
      } catch (endpointErr) {
        console.warn(`[ShopHome] catalog-category fetch for ${catKey} page ${page} failed:`, endpointErr);
      }

      // Fallback for custom categories like "computers" (and any temporary endpoint misses)
      if (mapped.length === 0 && page === 0) {
        const queries = CATEGORY_SEARCH_QUERIES[catKey] || [catKey.replace('_', ' ')];
        const fallbackPool: Product[] = [];

        for (const q of queries.slice(0, 4)) {
          try {
            const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 50, client: 'web' });
            const searchItems = (data?.items || [])
              .map(mapSearchItemToProduct)
              .filter(isValidProduct)
              .filter(p => isRelevantToCategory(p, catKey));
            fallbackPool.push(...searchItems);
          } catch {
            // Continue with next query
          }
        }

        mapped = deduplicateProducts(sortByLuxury(fallbackPool)).slice(0, PAGE_SIZE);
        if (totalCount === 0) totalCount = mapped.length;
      }

      if (append) {
        setCategoryProducts(prev => {
          const combined = deduplicateProducts([...prev, ...mapped]);
          categoryProductsCacheRef.current[catKey] = { products: combined, count: Math.max(totalCount, combined.length) };
          return combined;
        });
      } else {
        setCategoryProducts(mapped);
        categoryProductsCacheRef.current[catKey] = { products: mapped, count: Math.max(totalCount, mapped.length) };
      }
      setCategoryTotalCount(Math.max(totalCount, mapped.length));
    } catch (err) {
      console.warn(`[ShopHome] Category fetch for ${catKey} page ${page} failed:`, err);
    } finally {
      setCategoryProductsLoading(false);
      setCategoryLoadingMore(false);
    }
  }, [language]);

  // Load category products: instant from cache, first page from API, manual Load More only
  useEffect(() => {
    if (providerFilter && providerFilter !== 'all') return;
    if (!categoryFilter || categoryFilter === 'all') {
      setCategoryProducts([]);
      setCategoryTotalCount(0);
      setCategoryProductsPage(0);
      return;
    }
    const cached = categoryProductsCacheRef.current[categoryFilter];
    if (cached) {
      setCategoryProducts(cached.products);
      setCategoryTotalCount(cached.count);
      setCategoryProductsPage(Math.ceil(cached.products.length / 200));
      return;
    }
    setCategoryProductsPage(0);
    fetchCategoryPage(categoryFilter, 0, false);
  }, [categoryFilter, providerFilter, fetchCategoryPage]);

  const handleCategoryLoadMore = useCallback(() => {
    const nextPage = categoryProductsPage + 1;
    setCategoryProductsPage(nextPage);
    fetchCategoryPage(categoryFilter, nextPage, true);
  }, [categoryProductsPage, categoryFilter, fetchCategoryPage]);

  /** Client-side provider filter helper */
  const filterByProvider = useCallback((items: Product[]) => {
    if (!providerFilter || providerFilter === 'all') return items;
    const filterKey = providerFilter === 'amazon' ? 'rainforest' : providerFilter;
    return items.filter(p => {
      const prov = (p.provider || '').toLowerCase();
      return prov === filterKey || prov === providerFilter;
    });
  }, [providerFilter]);

  /** Client-side category filter helper */
  const filterByCategory = useCallback((items: Product[]) => {
    if (!categoryFilter || categoryFilter === 'all') return items;
    return items.filter(p => isRelevantToCategory(p, categoryFilter));
  }, [categoryFilter]);

  /** Combined filter: provider + category */
  const applyFilters = useCallback((items: Product[]) => {
    return filterByCategory(filterByProvider(items));
  }, [filterByProvider, filterByCategory]);

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
  const fetchCategoryItems = useCallback(async (categories: string[]) => {
    const tasks = categories.map((catKey) => async () => {
      setCategoryLoadingMap(prev => ({ ...prev, [catKey]: true }));
      // For slow categories, show cached curated result instantly
      let backgroundRefresh = false;
      if (SLOW_CATEGORIES.has(catKey)) {
        const cached = getCachedCategoryResult(catKey);
        if (cached) {
          // Re-validate cached items: filter out stale misclassified or bad-image products
          const validated = filterForCategory(
            cached.filter(p => p.imageUrl && isRenderableImageUrl(p.imageUrl)),
            catKey
          );
          if (validated.length > 0) {
            setCategoryItems(prev => ({ ...prev, [catKey]: validated }));
            setCategoryLoadingMap(prev => ({ ...prev, [catKey]: false }));
            backgroundRefresh = true;
          }
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
            '2026 Tesla Model Y Long Range',
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

          // Fallback: if fewer than 4 vehicles, run broader queries
          if (items.length < 4) {
            const BROAD_VEHICLE_QUERIES = [
              'Tesla Model Y SUV',
              'GMC Yukon SUV',
              'Ford Explorer SUV',
              'Hyundai Santa Fe SUV',
              'Range Rover Sport',
              'BMW X5 SUV',
            ];
            for (const q of BROAD_VEHICLE_QUERIES) {
              if (items.length >= 4) break;
              try {
                const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 10 });
                const searchItems = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct).filter(isVehicleItem);
                for (const p of searchItems) {
                  if (items.length >= 4) break;
                  const key = p.id + '|' + (p.title || '').slice(0, 30);
                  if (seenIds.has(key)) continue;
                  seenIds.add(key);
                  items.push(p);
                  break;
                }
              } catch (e) {
                console.warn(`[Vehicles] broad fallback "${q}" failed:`, e);
              }
            }
            console.log(`[Vehicles] after broad fallback: ${items.length} items`);
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

    // Provider diversity: interleave so eBay and Amazon alternate
    const interleaved: Product[] = [];
    const byProvider: Record<string, Product[]> = {};
    for (const p of trending) {
      const prov = (p.provider || 'ebay').toLowerCase();
      const key = prov === 'rainforest' ? 'amazon' : prov;
      if (!byProvider[key]) byProvider[key] = [];
      byProvider[key].push(p);
    }
    const providerQueues = Object.values(byProvider).sort((a, b) => b.length - a.length);
    let qi = 0;
    while (interleaved.length < trending.length) {
      let added = false;
      for (const queue of providerQueues) {
        if (qi < queue.length) {
          interleaved.push(queue[qi]);
          added = true;
        }
      }
      if (!added) break;
      qi++;
    }

    return interleaved.slice(0, 16);
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
    // Wave 1: above-fold promo categories
    fetchCategoryItems(PROMO_CATEGORIES).then(() => {
      // Wave 2: remaining categories after a short delay
      setTimeout(() => {
        const remaining = ALL_HOMEPAGE_CATEGORIES.filter(k => !PROMO_CATEGORIES.includes(k));
        fetchCategoryItems(remaining).then(scheduleCategoryPrefetch);
      }, 300);
    });
    loadRecentlyViewed();
  }, []);

  // Re-fetch on language change
  useEffect(() => {
    if (!fetchedRef.current) return;
    fetchAccueilFeed();
    fetchCategoryItems(ALL_HOMEPAGE_CATEGORIES);
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
      <section className="mb-5">
        <HeroBannerCarousel />
      </section>

      <main className="pb-8">
        <div className="container mx-auto px-3 sm:px-4">
          {/* Filters Row - Store + Category */}
          <div className="grid grid-cols-2 sm:flex sm:justify-end gap-2 mb-4">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-[180px] bg-white/10 border border-white/20 text-white rounded-full h-11 px-4 text-sm">
                <SelectValue placeholder={language === 'fr' ? 'Catégorie' : 'Category'} />
              </SelectTrigger>
              <SelectContent className="bg-black border border-white/20 z-[9999]">
                {CATEGORY_FILTER_OPTIONS.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    className="text-white hover:bg-white/10 focus:bg-white/10 focus:text-white cursor-pointer"
                  >
                    {language === 'fr' ? opt.labelFr : opt.labelEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={providerFilter} onValueChange={setProviderFilter}>
              <SelectTrigger className="w-full sm:w-[190px] bg-white/10 border border-white/20 text-white rounded-full h-11 px-4 text-sm">
                <SelectValue placeholder={language === 'fr' ? 'Boutique' : 'Store'} />
              </SelectTrigger>
              <SelectContent className="bg-black border border-white/20 z-[9999]">
                <SelectItem
                  value="all"
                  className="text-white hover:bg-white/10 focus:bg-white/10 focus:text-white cursor-pointer"
                >
                  {language === 'fr' ? 'Tous les magasins' : 'All Stores'}
                </SelectItem>
                {dynamicStores.map((opt) => (
                  <SelectItem
                    key={opt.value}
                    value={opt.value}
                    disabled={opt.count === 0}
                    className={`text-white hover:bg-white/10 focus:bg-white/10 focus:text-white cursor-pointer ${opt.count === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    {opt.label} {opt.count > 0 ? `(${opt.count.toLocaleString()})` : (language === 'fr' ? '(bientôt)' : '(coming soon)')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {providerFilter && providerFilter !== 'all' ? (
            /* ====== STORE-FILTERED FLAT GRID ====== */
            storeProductsLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-white/40" />
              </div>
            ) : storeProducts.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-white/50 text-lg">
                  {language === 'fr'
                    ? `Aucun produit trouvé pour ${providerFilter}`
                    : `No products found for ${providerFilter}`}
                </p>
                <p className="text-white/30 text-sm mt-2">
                  {language === 'fr' ? 'Les produits sont en cours d\'indexation...' : 'Products are being indexed...'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white/90">
                    {PROVIDER_DISPLAY[providerFilter] || providerFilter.charAt(0).toUpperCase() + providerFilter.slice(1)} — {language === 'fr' ? 'Affichage' : 'Showing'} {filterByCategory(storeProducts).length.toLocaleString()} {language === 'fr' ? 'sur' : 'of'} {storeTotalCount.toLocaleString()} {language === 'fr' ? 'produits' : 'products'}
                  </h2>
                </div>
                <SectionBlock
                  items={filterByCategory(storeProducts)}
                  mode="static-grid"
                  maxItems={filterByCategory(storeProducts).length}
                />
                {storeProducts.length < storeTotalCount && (
                  <div className="flex justify-center pt-4">
                    <Button
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      variant="outline"
                      className="border-white/20 text-white/90 hover:bg-white/10 min-w-[200px]"
                    >
                      {loadingMore ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : null}
                      {language === 'fr' ? 'Charger plus' : 'Load More'}
                    </Button>
                  </div>
                )}
              </div>
            )
          ) : categoryFilter && categoryFilter !== 'all' && (!providerFilter || providerFilter === 'all') ? (
            /* ====== CATEGORY-ONLY FLAT GRID ====== */
            categoryProductsLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-white/40" />
              </div>
            ) : categoryProducts.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-white/50 text-lg">
                  {language === 'fr'
                    ? `Aucun produit trouvé pour ${getCategoryTitle(categoryFilter, language)}`
                    : `No products found for ${getCategoryTitle(categoryFilter, language)}`}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white/90">
                    {getCategoryTitle(categoryFilter, language)} — {language === 'fr' ? 'Affichage' : 'Showing'} {categoryProducts.length.toLocaleString()} {language === 'fr' ? 'sur' : 'of'} {categoryTotalCount.toLocaleString()} {language === 'fr' ? 'produits' : 'products'}
                  </h2>
                </div>
                <SectionBlock
                  items={categoryProducts}
                  mode="static-grid"
                  maxItems={categoryProducts.length}
                />
                {categoryProducts.length < categoryTotalCount && (
                  <div className="flex justify-center pt-4">
                    <Button
                      onClick={handleCategoryLoadMore}
                      disabled={categoryLoadingMore}
                      variant="outline"
                      className="border-white/20 text-white/90 hover:bg-white/10 min-w-[200px]"
                    >
                      {categoryLoadingMore ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : null}
                      {language === 'fr' ? 'Charger plus' : 'Load More'}
                    </Button>
                  </div>
                )}
              </div>
            )
          ) : isInitialLoading ? (
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
            <div className="space-y-6">

              {/* Paste-Link CTA Banner */}
              <Link
                to="/paste-link"
                className="group relative block overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent p-4 sm:p-5 transition-all hover:border-primary/50 hover:shadow-[0_0_30px_-5px_hsl(var(--primary)/0.3)]"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative space-y-3 sm:space-y-3.5">
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-primary/20 border border-primary/30 group-hover:bg-primary/30 transition-colors">
                      <Link2 className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-1">
                        <p className="text-sm sm:text-lg font-bold text-white leading-tight">
                          {language === 'fr' ? "Collez le lien. On calcule le prix." : "Paste the link. We get the price."}
                        </p>
                      </div>
                      <p className="text-xs sm:text-sm text-white/65 leading-snug">
                        {language === 'fr' ? "Introuvable en catalogue ? Collez le lien du produit." : "Can’t find it in catalog? Paste the product link."}
                      </p>
                    </div>

                    <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5 text-primary flex-shrink-0 mt-1 group-hover:translate-x-1 transition-transform" />
                  </div>

                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <div className="h-10 sm:h-11 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center">
                      <img src="/images/logos/amazon.svg" alt="Amazon" className="h-4 sm:h-5 w-auto max-w-[72px] sm:max-w-[95px] object-contain opacity-90" />
                    </div>
                    <div className="h-10 sm:h-11 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center">
                      <img src="/images/logos/shein-white.svg" alt="SHEIN" className="h-3.5 sm:h-4.5 w-auto object-contain opacity-90" />
                    </div>
                    <div className="h-10 sm:h-11 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center">
                      <img src="/images/logos/tesla-official.png" alt="Tesla" className="h-5 sm:h-6 w-auto object-contain opacity-90" />
                    </div>
                  </div>
                </div>
              </Link>

              {/* 2) Trending Grid — 16 diverse luxury items */}
              {applyFilters(trendingFeed).length > 0 && (
                <SectionBlock
                  title={language === 'fr' ? 'Tendances' : 'Trending Now'}
                  items={applyFilters(trendingFeed)}
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
                    items={applyFilters(categoryItems[catKey] ?? [])}
                    loading={categoryLoadingMap[catKey] === true}
                    mode="grid"
                    categoryKey={catKey}
                  />
                ))}
              </div>

              {/* 4) Recently Viewed */}
              {applyFilters(recentlyViewed).length > 0 && (
                <LazySection minHeight={180}>
                  <div className="bg-[#1a1d23] border border-white/[0.08] rounded-2xl p-3 sm:p-4 shadow-md">
                    <div className="flex items-center gap-2 mb-3 px-1">
                      <Clock className="h-4 w-4 text-white/60" />
                      <h2 className="text-lg font-semibold text-white/90">
                        {language === 'fr' ? 'Vus récemment' : 'Recently Viewed'}
                      </h2>
                    </div>
                    <HorizontalProductRow products={applyFilters(recentlyViewed)} />
                  </div>
                </LazySection>
              )}

              {/* 5) Remaining Category Grid Cards */}
              <LazySection minHeight={600}>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {ALL_HOMEPAGE_CATEGORIES.filter(k => !PROMO_CATEGORIES.includes(k)).map(catKey => (
                    <SectionBlock
                      key={catKey}
                      title={getCategoryTitle(catKey, language)}
                      items={applyFilters(categoryItems[catKey] ?? [])}
                      loading={categoryLoadingMap[catKey] === true}
                      mode="grid"
                      categoryKey={catKey}
                    />
                  ))}
                </div>
              </LazySection>

              {/* 6) Category Icons Row */}
              <LazySection minHeight={80}>
                <CategoryIconsRow />
              </LazySection>
            </div>
          )}
        </div>
      </main>

      <ShopFooter />
      <BottomNavigation />
    </div>
  );
}
