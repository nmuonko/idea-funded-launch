import { useState, useEffect, useMemo } from 'react';
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
  beauty_health: ['perfume fragrance', 'skincare serum moisturizer', 'makeup cosmetics lipstick', 'hair dryer curling iron'],
  audio_music: ['bluetooth speaker JBL Bose', 'headphones wireless noise cancelling', 'electric guitar acoustic', 'turntable vinyl record player'],
  shoes_sneakers: ['Nike Air Max sneakers', 'Adidas Yeezy shoes', 'Jordan retro basketball shoe', 'New Balance running shoe'],
  cameras_photo: ['Canon EOS DSLR camera', 'Sony Alpha mirrorless camera', 'GoPro action camera', 'camera lens tripod'],
  electronics: ['laptop notebook computer', 'tablet iPad Samsung', 'monitor 4K display', 'drone camera'],
  clothing: ['designer jacket coat', 'premium dress fashion', 'hoodie sweater men', 'handbag luxury leather'],
  collectibles: ['Pokemon trading card graded', 'vintage collectible figurine', 'Funko Pop limited edition', 'signed memorabilia'],
  refurbished: ['refurbished iPhone certified', 'renewed MacBook laptop', 'refurbished iPad tablet', 'certified pre-owned Samsung'],
  parts_accessories: ['brake pad rotor', 'car headlight assembly', 'OEM auto parts', 'catalytic converter exhaust'],
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
const SHOE_OWNER_CATS = new Set(['shoes_sneakers', 'sporting_goods']);
const WATCH_JEWELRY_OWNER_CATS = new Set(['jewelry_watches']);
const TOY_OWNER_CATS = new Set(['toys', 'collectibles']);

const CATEGORY_EXCLUDE_KEYWORDS: Record<string, string[]> = {
  electronics: ['sofa', 'couch', 'recliner', 'dining', 'bed', 'mattress', 'rug', 'curtain', 'furniture', 'garden', 'pillow', 'décor', 'decor', 'dress', 'shirt', 'pants', 'clothing', 'fashion', 'phone case', 'screen protector', 'ps5', 'playstation', 'xbox', 'nintendo', 'console', 'game disc', 'guitar', 'drum', 'piano', 'yoga', 'exercise', 'workout', 'sport', 'perfume', 'cologne', 'makeup'],
  gaming: ['sofa', 'couch', 'bed', 'mattress', 'furniture', 'kitchen', 'garden', 'dress', 'shirt', 'charger', 'cable', 'cooling fan', 'internal fan', 'replacement fan', 'gaming chair', 'chair', 'desk', 'skin', 'decal', 'speaker', 'guitar', 'piano', 'perfume', 'sofa set', 'dining table', 'makeup', 'cologne'],
  phones: ['sofa', 'bed', 'table', 'chair', 'furniture', 'kitchen', 'garden', 'dress', 'mattress', 'case', 'protector', 'screen protector', 'cable', 'charger', 'mount', 'holder', 'stand', 'tempered glass', 'cover', 'wallet', 'strap', 'armband', 'phone case', 'phone mount', 'phone holder', 'phone stand', 'phone charger', 'phone cable', 'car mount', 'film', 'adapter', 'earphones', 'earbuds', 'headphone'],
  vehicles: ['iphone', 'macbook', 'ps5', 'laptop', 'tablet', 'smartphone', 'dress', 'shirt', 'sofa', 'bed', 'charger', 'cable', 'stereo', 'gps', 'carplay', 'android auto', 'dash cam', 'phone mount', 'car charger', 'phone holder', 'bluetooth adapter', 'fm transmitter', 'screen protector', 'tempered glass', 'floor mat', 'seat cover', 'phone', 'head unit', 'radio', 'brake pad', 'oil filter', 'wiper', 'spark plug', 'alternator', 'bumper cover', 'perfume', 'cologne'],
  clothing: ['iphone', 'ps5', 'macbook', 'laptop', 'tablet', 'sofa', 'couch', 'bed', 'mattress', 'fridge', 'microwave', 'phone case', 'car part', 'charger', 'cable', 'electronic', 'appliance', 'lego', 'toy', 'puzzle', 'doll', 'action figure', 'building block', 'playset', 'yoga mat', 'treadmill', 'dumbbell', 'exercise', 'auto part', 'brake pad', 'oil filter', 'car battery', 'headlight', 'spark plug', 'wiper', 'sofa set', 'dining table', 'refrigerator', 'vacuum', 'blender', 'lingerie', 'bikini', 'thong', 'lace bra', 'sexy', 'lingerie set', 'sneaker', 'sneakers', 'air max', 'air force 1', 'dunk low', 'dunk high', 'yeezy', 'running shoe', 'basketball shoe', 'hiking boot', 'camera', 'lens', 'tripod'],
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
  'collectibles', 'cameras_photo',
];
const FETCH_CATEGORY_KEYS = ALL_HOMEPAGE_CATEGORIES;
const PROMO_CATEGORIES = ALL_HOMEPAGE_CATEGORIES.slice(0, 4);
const MORE_CATEGORIES = ALL_HOMEPAGE_CATEGORIES.slice(4);

const LUXURY_KEYWORDS = ['pro', 'max', 'ultra', 'premium', 'oled', 'macbook', 'rolex', 'diamond', 'gold', 'luxury', 'designer', '4k', '8k', 'titanium'];

export default function ShopHome() {
  const { language } = useLanguage();
  const { user } = useAuth();

  const [accueilProducts, setAccueilProducts] = useState<Product[]>([]);
  const [accueilLoading, setAccueilLoading] = useState(true);
  const [categorySections, setCategorySections] = useState<Record<string, Product[]>>({});
  const [categoryLoading, setCategoryLoading] = useState(true);
  const [recentlyViewed, setRecentlyViewed] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);

  const t = translations[language] || translations.en;
  const shop = t.shop;

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

  // ====== ACCUEIL DATA ======
  const fetchAccueilFeed = async () => {
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
  };

  const fetchCategorySections = async () => {
    setCategoryLoading(true);
    try {
      const results = await Promise.allSettled(
        FETCH_CATEGORY_KEYS.map(async (cat) => {
          const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-home', {
            category: cat,
            page: 1,
            pageSize: 80,
            client: 'web',
          });
          const rawItems = data?.sections?.[0]?.items?.map(mapItemToProduct).filter(p => p.id && p.priceUsd > 0) || [];
          return { cat, items: rawItems };
        })
      );
      const map: Record<string, Product[]> = {};
      results.forEach((r) => {
        if (r.status === 'fulfilled' && r.value.items.length > 0) {
          map[r.value.cat] = r.value.items;
        }
      });
      setCategorySections(map);
    } catch (err) {
      console.error('[ShopHome] category sections fetch error', err);
    } finally {
      setCategoryLoading(false);
    }
  };

  const loadRecentlyViewed = async () => {
    try {
      const items = await getRecentlyViewed(user?.id, 12);
      setRecentlyViewed(items);
    } catch (err) {
      console.warn('[ShopHome] recently viewed fetch failed', err);
    }
  };

  // ====== UNIFIED SECTION BUILDER ======
  const { trendingFeed, categoryGrids } = useMemo(() => {
    const dedup = new Set<string>();

    const sortByLuxury = (items: Product[]) =>
      [...items].sort((a, b) => {
        const aLux = LUXURY_KEYWORDS.some(kw => (a.title || '').toLowerCase().includes(kw)) ? 1 : 0;
        const bLux = LUXURY_KEYWORDS.some(kw => (b.title || '').toLowerCase().includes(kw)) ? 1 : 0;
        if (bLux !== aLux) return bLux - aLux;
        return (b.priceUsd || 0) - (a.priceUsd || 0);
      });

    // STRICT pick: must match include keyword AND not match any exclude keyword
    const pickStrict = (candidates: Product[], catKey: string, max: number): Product[] => {
      const result: Product[] = [];
      const effectiveExcludes = getEffectiveExcludes(catKey);
      const keywords = CATEGORY_KEYWORDS[catKey];
      for (const p of candidates) {
        if (result.length >= max) break;
        if (dedup.has(p.id)) continue;
        const titleLower = (p.title || '').toLowerCase();
        if (effectiveExcludes.some(ex => titleLower.includes(ex))) continue;
        if (keywords && !keywords.some(kw => titleLower.includes(kw))) continue;
        result.push(p);
        dedup.add(p.id);
      }
      return result;
    };

    // EXCLUDE-ONLY pick: trust backend categorization, just block contaminants
    const pickExcludeOnly = (candidates: Product[], catKey: string, max: number): Product[] => {
      const result: Product[] = [];
      const effectiveExcludes = getEffectiveExcludes(catKey);
      for (const p of candidates) {
        if (result.length >= max) break;
        if (dedup.has(p.id)) continue;
        const titleLower = (p.title || '').toLowerCase();
        if (effectiveExcludes.some(ex => titleLower.includes(ex))) continue;
        result.push(p);
        dedup.add(p.id);
      }
      return result;
    };

    // TWO-TIER builder: exclude-only for dedicated feeds, strict for general pool
    const buildGrid4 = (catKey: string): Product[] => {
      // Stage A: EXCLUDE-ONLY from dedicated feed (backend already categorized these)
      const dedicated = sortByLuxury(categorySections[catKey] || []);
      let items = pickExcludeOnly(dedicated, catKey, 4);
      // Stage B: STRICT from accueil pool (uncategorized, must prove relevance)
      if (items.length < 4) {
        items = [...items, ...pickStrict(sortByLuxury(accueilProducts), catKey, 4 - items.length)];
      }
      return items.slice(0, 4);
    };

    // 1) TRENDING (16 items, round-robin luxury-biased)
    const trendingCats = ['phones', 'electronics', 'vehicles', 'jewelry_watches', 'gaming', 'clothing', 'audio_music', 'cameras_photo', 'beauty_health', 'shoes_sneakers'];
    const trending: Product[] = [];
    for (const cat of trendingCats) {
      const dedicated = sortByLuxury([...(categorySections[cat] || []), ...accueilProducts.filter(p => isRelevantToCategory(p, cat))]);
      let count = 0;
      for (const p of dedicated) {
        if (count >= 2) break;
        if (!dedup.has(p.id)) {
          const titleLower = (p.title || '').toLowerCase();
          const excludes = getEffectiveExcludes(cat);
          if (excludes.some(ex => titleLower.includes(ex))) continue;
          trending.push(p);
          dedup.add(p.id);
          count++;
        }
      }
    }
    if (trending.length < 16) {
      const trendingAllowedCats = ['phones', 'electronics', 'gaming', 'vehicles', 'jewelry_watches', 'clothing', 'audio_music', 'cameras_photo', 'beauty_health', 'shoes_sneakers'];
      const validAccueil = accueilProducts.filter(p => {
        if ((p.priceUsd || 0) < 20) return false;
        const title = (p.title || '').toLowerCase();
        return trendingAllowedCats.some(cat => {
          const kws = CATEGORY_KEYWORDS[cat];
          const exs = getEffectiveExcludes(cat);
          return kws?.some(kw => title.includes(kw)) && !exs.some(ex => title.includes(ex));
        });
      });
      for (const p of sortByLuxury(validAccueil)) {
        if (trending.length >= 16) break;
        if (!dedup.has(p.id)) {
          trending.push(p);
          dedup.add(p.id);
        }
      }
    }
    // Last-resort backfill from any accueil product with price > 0
    if (trending.length < 16) {
      for (const p of sortByLuxury(accueilProducts)) {
        if (trending.length >= 16) break;
        if (!dedup.has(p.id) && (p.priceUsd || 0) > 0) {
          trending.push(p);
          dedup.add(p.id);
        }
      }
    }

    // 2) ALL CATEGORY GRIDS
    const grids: Array<{ key: string; items: Product[] }> = [];
    for (const catKey of ALL_HOMEPAGE_CATEGORIES) {
      const items = buildGrid4(catKey);
      grids.push({ key: catKey, items });
    }

    return {
      trendingFeed: trending.slice(0, 16),
      categoryGrids: grids,
    };
  }, [categorySections, accueilProducts]);

  // ====== ASYNC TOP-UP: fetch from catalog-category for ALL categories ======
  const [topUpPools, setTopUpPools] = useState<Record<string, Product[]>>({});

  useEffect(() => {
    // Fetch top-up pools for ALL categories to ensure deep candidate pools
    if (categoryLoading || accueilLoading) return;
    let cancelled = false;
    console.debug('[ShopHome] Top-up: fetching pools for all categories');
    (async () => {
      const results = await Promise.allSettled(
        ALL_HOMEPAGE_CATEGORIES.map(async (cat) => {
          const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-category', {
            category: cat,
            limit: 300,
            client: 'web',
            language,
          });
          const items = data?.sections?.[0]?.items?.map(mapItemToProduct).filter((p: Product) => p.id && p.priceUsd > 0) || [];
          return { cat, items };
        })
      );
      if (cancelled) return;
      const pools: Record<string, Product[]> = {};
      results.forEach(r => {
        if (r.status === 'fulfilled') pools[r.value.cat] = r.value.items;
      });
      setTopUpPools(pools);
    })();
    return () => { cancelled = true; };
  }, [categoryLoading, accueilLoading, language]);

  // Merge top-up pools into grids — EXCLUDE-ONLY for top-up (backend categorized)
  const finalCategoryGrids = useMemo(() => {
    if (Object.keys(topUpPools).length === 0) return categoryGrids;
    const usedIds = new Set(categoryGrids.flatMap(g => g.items.map(i => i.id)));
    // Also add trending IDs to avoid cross-contamination
    trendingFeed.forEach(p => usedIds.add(p.id));
    
    return categoryGrids.map(g => {
      if (g.items.length >= 4) return g;
      const pool = topUpPools[g.key];
      if (!pool) return g;
      const effectiveExcludes = getEffectiveExcludes(g.key);
      const extra: Product[] = [];
      const sorted = [...pool].sort((a, b) => {
        const aLux = LUXURY_KEYWORDS.some(kw => (a.title || '').toLowerCase().includes(kw)) ? 1 : 0;
        const bLux = LUXURY_KEYWORDS.some(kw => (b.title || '').toLowerCase().includes(kw)) ? 1 : 0;
        if (bLux !== aLux) return bLux - aLux;
        return (b.priceUsd || 0) - (a.priceUsd || 0);
      });
      for (const p of sorted) {
        if (g.items.length + extra.length >= 4) break;
        if (usedIds.has(p.id)) continue;
        const titleLower = (p.title || '').toLowerCase();
        // EXCLUDE-ONLY: trust backend categorization, just block contaminants
        if (effectiveExcludes.some(ex => titleLower.includes(ex))) continue;
        extra.push(p);
        usedIds.add(p.id);
      }
      return { key: g.key, items: [...g.items, ...extra].slice(0, 4) };
    });
  }, [categoryGrids, topUpPools, trendingFeed]);

  // ====== SEARCH FALLBACK: for categories still empty after top-up ======
  const [searchFallbacks, setSearchFallbacks] = useState<Record<string, Product[]>>({});

  useEffect(() => {
    if (Object.keys(topUpPools).length === 0) return; // Wait for top-up to finish first
    const emptyKeys = finalCategoryGrids.filter(g => g.items.length < 4).map(g => g.key);
    if (emptyKeys.length === 0) return;

    let cancelled = false;
    console.debug('[ShopHome] Search fallback for:', emptyKeys);
    (async () => {
      const results = await Promise.allSettled(
        emptyKeys.map(async (cat) => {
          const queries = CATEGORY_SEARCH_QUERIES[cat] || [CATEGORY_KEYWORDS[cat]?.[0] || cat.replace('_', ' ')];
          const allItems: Product[] = [];
          for (const q of queries.slice(0, 3)) {
            if (allItems.length >= 8) break;
            try {
              const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 8 });
              const items = (data?.items || []).map((item: any) => ({
                id: item.id || item.providerProductId || '',
                provider: item.provider === 'rainforest' ? 'amazon' : (item.provider || 'amazon'),
                title: item.title || 'Product',
                imageUrl: item.imageUrl || item.mainImageUrl || item.image_url || '',
                priceUsd: item.priceUsd || item.price_usd || 0,
                rating: item.rating,
                inStock: item.inStock !== false,
                productUrl: item.productUrl || item.product_url,
              })).filter((p: Product) => p.id && p.priceUsd > 0 && p.imageUrl);
              allItems.push(...items);
            } catch (e) {
              console.warn(`[ShopHome] search fallback failed for "${q}"`, e);
            }
          }
          return { cat, items: allItems };
        })
      );
      if (cancelled) return;
      const fb: Record<string, Product[]> = {};
      results.forEach(r => {
        if (r.status === 'fulfilled' && r.value.items.length > 0) {
          fb[r.value.cat] = r.value.items;
        }
      });
      if (Object.keys(fb).length > 0) {
        setSearchFallbacks(prev => ({ ...prev, ...fb }));
      }
    })();
    return () => { cancelled = true; };
  }, [finalCategoryGrids, topUpPools]);

  // Merge search fallbacks into final grids
  const displayGrids = useMemo(() => {
    if (Object.keys(searchFallbacks).length === 0) return finalCategoryGrids;
    const usedIds = new Set(finalCategoryGrids.flatMap(g => g.items.map(i => i.id)));
    trendingFeed.forEach(p => usedIds.add(p.id));

    return finalCategoryGrids.map(g => {
      if (g.items.length >= 4) return g;
      const pool = searchFallbacks[g.key];
      if (!pool) return g;
      const effectiveExcludes = getEffectiveExcludes(g.key);
      const extra: Product[] = [];
      for (const p of pool) {
        if (g.items.length + extra.length >= 4) break;
        if (usedIds.has(p.id)) continue;
        const titleLower = (p.title || '').toLowerCase();
        if (effectiveExcludes.some(ex => titleLower.includes(ex))) continue;
        extra.push(p);
        usedIds.add(p.id);
      }
      return { key: g.key, items: [...g.items, ...extra].slice(0, 4) };
    });
  }, [finalCategoryGrids, searchFallbacks, trendingFeed]);

  // ====== EFFECTS ======
  useEffect(() => {
    fetchAccueilFeed();
    fetchCategorySections();
    loadRecentlyViewed();
  }, [language]);

  useEffect(() => {
    loadRecentlyViewed();
  }, [user?.id]);


  const isLoading = accueilLoading && categoryLoading;

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
          {isLoading ? (
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
                {displayGrids.filter(g => PROMO_CATEGORIES.includes(g.key)).map(({ key: catKey, items }) => (
                  <SectionBlock
                    key={catKey}
                    title={getCategoryTitle(catKey, language)}
                    items={items}
                    loading={items.length === 0}
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
                {displayGrids.filter(g => !PROMO_CATEGORIES.includes(g.key)).map(({ key: catKey, items }) => (
                  <SectionBlock
                    key={catKey}
                    title={getCategoryTitle(catKey, language)}
                    items={items}
                    loading={items.length === 0}
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
