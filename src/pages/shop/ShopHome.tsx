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

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  phones: ['iphone', 'samsung galaxy', 'pixel phone', 'google pixel', 'smartphone', 'android phone', 'unlocked phone', 'cellphone', 'téléphone', 'oneplus', 'xiaomi', 'motorola', 'galaxy s2', 'galaxy s3', 'galaxy z fold', 'galaxy z flip', 'galaxy a5', 'galaxy a7', 'galaxy s24', 'galaxy s23', 'galaxy s22', 'galaxy note', 'iphone 1', 'iphone pro', 'iphone plus'],
  electronics: ['laptop', 'notebook', 'computer', 'tablet', 'monitor', 'headphone', 'speaker', 'camera', 'drone', 'television', 'earbuds', 'printer', 'router', 'hard drive', 'ssd', 'gpu', 'cpu', 'macbook', 'ipad', 'dell laptop', 'lenovo laptop', 'asus laptop', 'acer laptop', 'oled tv', 'qled tv', '4k tv', 'smart tv', 'mechanical keyboard', 'webcam', 'projector', 'soundbar'],
  gaming: ['ps5', 'playstation 5', 'playstation 4', 'xbox series', 'xbox one', 'nintendo switch', 'switch oled', 'video game', 'steam deck', 'gaming laptop', 'gaming monitor', 'gaming headset', 'dualsense', 'game disc', 'ps4', 'xbox console', 'controller', 'gamepad', 'joystick', 'gaming pc', 'rtx 40', 'rtx 30', 'geforce rtx'],
  vehicles: ['toyota', 'honda', 'bmw', 'ford f-', 'ford mustang', 'ford explorer', 'ford escape', 'motorcycle', 'jeep', 'nissan', 'mercedes-benz', 'mercedes benz', 'audi', 'hyundai', 'kia', 'chevrolet', 'land cruiser', 'mustang', 'rav4', 'cr-v', 'sedan', 'convertible', 'minivan', 'corvette', 'camaro', 'civic', 'accord', 'corolla', 'tacoma', 'wrangler', 'range rover', 'lexus', 'cadillac', 'escalade', 'tesla model'],
  clothing: ['shirt', 't-shirt', 'polo', 'hoodie', 'jacket', 'coat', 'jeans', 'pants', 'trousers', 'dress', 'skirt', 'suit', 'blazer', 'sweater', 'cardigan', 'abaya', 'kaftan', 'chemise', 'veste', 'pantalon', 'robe', 'manteau', 'pull', 'vêtement', 'blouse', 'sweatshirt', 'legging', 'tracksuit', 'handbag', 'gucci', 'prada', 'dior', 'burberry', 'louis vuitton'],
  home_garden: ['sofa', 'couch', 'dining table', 'bed frame', 'mattress', 'blender', 'microwave', 'oven', 'refrigerator', 'lamp', 'furniture', 'curtain', 'rug', 'shelf', 'cabinet', 'air conditioner', 'washer', 'dryer', 'dishwasher', 'vacuum', 'coffee maker', 'recliner', 'bookshelf', 'generator', 'solar panel', 'freezer', 'fridge'],
  toys: ['toy', 'jouet', 'lego', 'doll', 'puzzle', 'action figure', 'barbie', 'nerf', 'playset', 'plush', 'stuffed animal', 'board game', 'play-doh', 'hot wheels', 'building blocks', 'toy set'],
  sporting_goods: ['fitness equipment', 'gym equipment', 'yoga mat', 'running shoe', 'bicycle', 'soccer ball', 'basketball', 'tennis racket', 'golf club', 'camping', 'hiking', 'treadmill', 'dumbbell', 'exercise bike', 'kayak', 'garmin watch'],
  jewelry_watches: ['watch ', 'montre', 'bracelet', 'necklace', 'ring ', 'earring', 'jewelry', 'bijou', 'gold necklace', 'gold ring', 'gold bracelet', 'silver necklace', 'silver ring', 'diamond', 'rolex', 'casio watch', 'seiko', 'fossil watch', 'pendant', 'luxury watch', '14k', '18k', '10k gold'],
  parts_accessories: ['auto part', 'car part', 'brake pad', 'oil filter', 'alternator', 'car battery', 'headlight assembly', 'bumper', 'wiper blade', 'spark plug', 'transmission', 'radiator', 'pièce auto', 'oem part', 'catalytic converter', 'carplay', 'car stereo', 'dash cam', 'car gps'],
  refurbished: ['refurbished', 'renewed', 'reconditioned', 'reconditionné', 'certified pre-owned', 'factory refurbished'],
  beauty_health: ['perfume', 'cologne', 'skincare', 'makeup', 'lipstick', 'foundation', 'serum', 'moisturizer', 'shampoo', 'hair dryer', 'fragrance', 'cosmetic', 'face cream', 'nail polish', 'lotion', 'vitamins'],
  collectibles: ['trading card', 'pokemon card', 'vintage', 'antique', 'collectible', 'memorabilia', 'comic book', 'figurine', 'rare coin', 'yugioh'],
  audio_music: ['speaker', 'subwoofer', 'soundbar', 'home theater', 'amplifier', 'receiver', 'headphones', 'earbuds', 'bluetooth speaker', 'studio monitor', 'pa speaker', 'guitar', 'electric guitar', 'acoustic guitar', 'bass guitar', 'digital piano', 'midi controller', 'drum', 'drum kit', 'microphone', 'audio interface', 'turntable', 'hi-fi', 'surround sound', 'wireless speaker', 'portable speaker', 'bose', 'jbl', 'harman kardon', 'bang & olufsen', 'sennheiser', 'marshall', 'beats'],
  shoes_sneakers: ['nike', 'adidas', 'jordan', 'air max', 'new balance', 'puma', 'reebok', 'converse', 'vans', 'sneakers', 'running shoe', 'basketball shoe', 'yeezy', 'air force 1', 'dunk low', 'dunk high', 'boot', 'loafer', 'sandal', 'trail shoe', 'hiking boot', 'timberland', 'skechers', 'asics', 'under armour', 'shoe'],
  cameras_photo: ['canon', 'nikon', 'sony camera', 'fujifilm', 'gopro', 'dslr', 'mirrorless camera', 'camera lens', 'tripod', 'ring light', 'camera bag', 'drone camera', 'action camera', 'instant camera', 'polaroid', 'digital camera', 'camcorder', 'camera body', 'telephoto lens', 'wide angle lens', 'sony alpha', 'canon eos', 'nikon z'],
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
  clothing: ['iphone', 'ps5', 'macbook', 'laptop', 'tablet', 'sofa', 'couch', 'bed', 'mattress', 'fridge', 'microwave', 'phone case', 'car part', 'charger', 'cable', 'electronic', 'appliance', 'lego', 'toy', 'puzzle', 'doll', 'action figure', 'building block', 'playset', 'yoga mat', 'treadmill', 'dumbbell', 'exercise', 'auto part', 'brake pad', 'oil filter', 'car battery', 'headlight', 'spark plug', 'wiper', 'sofa set', 'dining table', 'refrigerator', 'vacuum', 'blender', 'lingerie', 'bikini', 'thong', 'lace bra', 'sexy', 'lingerie set'],
  home_garden: ['iphone', 'ps5', 'macbook', 'laptop', 'smartphone', 'playstation', 'xbox', 'nintendo', 'gpu', 'earbuds', 'phone case', 'gaming', 'video game', 'console', 'hdmi', 'usb', 'cable', 'apple watch', 'smartwatch', 'airpods', 'headphones', 'samsung galaxy', 'trading card', 'pokemon', 'carplay', 'stereo', 'perfume', 'cologne', 'makeup'],
  toys: ['iphone', 'macbook', 'laptop', 'sofa', 'bed', 'mattress', 'ps5', 'phone case', 'charger', 'cable', 'brake pad', 'oil filter', 'perfume', 'cologne'],
  sporting_goods: ['iphone', 'macbook', 'ps5', 'sofa', 'bed', 'mattress', 'laptop', 'tablet', 'phone case', 'gaming', 'charger', 'cable', 'console', 'playstation', 'xbox', 'nintendo', 'trading card', 'pokemon', 'perfume', 'cologne'],
  jewelry_watches: ['iphone', 'ps5', 'macbook', 'laptop', 'sofa', 'bed', 'mattress', 'phone case', 'charger', 'cable', 'tool', 'appliance', 'furniture', 'brake pad', 'perfume', 'cologne', 'makeup'],
  parts_accessories: ['iphone', 'samsung galaxy', 'macbook', 'laptop', 'ps5', 'playstation', 'xbox', 'nintendo', 'sofa', 'bed', 'dress', 'shirt', 'perfume', 'makeup', 'tablet', 'airpods', 'headphones', 'speaker', 'cologne'],
  beauty_health: ['sofa', 'bed', 'mattress', 'iphone', 'ps5', 'laptop', 'console', 'brake pad', 'car part', 'cable', 'charger', 'camera', 'lens', 'xbox', 'nintendo', 'playstation'],
  collectibles: ['sofa', 'bed', 'mattress', 'iphone', 'laptop', 'ps5', 'brake pad', 'oil filter', 'charger', 'cable', 'perfume', 'cologne'],
  audio_music: ['ps5', 'playstation', 'xbox', 'nintendo', 'console', 'controller', 'game disc', 'gaming chair', 'cooling fan', 'video game', 'case', 'cover', 'protector', 'screen protector', 'tempered glass', 'mount', 'holder', 'stand', 'adapter', 'replacement', 'spare', 'repair', 'car gps', 'carplay', 'android auto', 'dash cam', 'phone case', 'sofa', 'bed', 'mattress', 'furniture', 'dress', 'shirt', 'iphone', 'samsung galaxy', 'laptop', 'brake pad', 'oil filter', 'perfume', 'cologne', 'makeup'],
  shoes_sneakers: ['iphone', 'ps5', 'macbook', 'laptop', 'tablet', 'sofa', 'bed', 'mattress', 'phone case', 'charger', 'cable', 'lego', 'toy', 'car part', 'brake pad', 'console', 'gaming', 'perfume', 'cologne'],
  cameras_photo: ['sofa', 'bed', 'mattress', 'phone case', 'dress', 'shirt', 'lego', 'car part', 'charger cable', 'ps5', 'playstation', 'xbox', 'console', 'brake pad', 'oil filter', 'perfume', 'cologne', 'carplay', 'stereo', 'makeup'],
  refurbished: [],
};

// Build effective excludes: category-specific + global excludes (shoes/watches/toys) unless owner
function getEffectiveExcludes(catKey: string): string[] {
  const base = CATEGORY_EXCLUDE_KEYWORDS[catKey] || [];
  const extras: string[] = [];
  if (!SHOE_OWNER_CATS.has(catKey)) extras.push(...GLOBAL_SHOE_TERMS);
  if (!WATCH_JEWELRY_OWNER_CATS.has(catKey)) extras.push(...GLOBAL_WATCH_JEWELRY_TERMS);
  if (!TOY_OWNER_CATS.has(catKey)) extras.push(...GLOBAL_TOY_TERMS);
  // Deduplicate
  return [...new Set([...base, ...extras])];
}

function isRelevantToCategory(product: Product, categoryKey: string): boolean {
  if (categoryKey === 'all') return true;
  const keywords = CATEGORY_KEYWORDS[categoryKey];
  if (!keywords) return true;
  const titleLower = (product.title || '').toLowerCase();
  // Must match at least one include keyword
  const matches = keywords.some(kw => titleLower.includes(kw));
  if (!matches) return false;
  // Must NOT match any effective exclude keyword
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

// All homepage categories in display order (source of truth — every one MUST render)
const ALL_HOMEPAGE_CATEGORIES = [
  'phones', 'electronics', 'audio_music', 'gaming', 'vehicles',
  'clothing', 'home_garden', 'toys', 'sporting_goods',
  'jewelry_watches', 'parts_accessories', 'refurbished',
  'beauty_health', 'collectibles', 'shoes_sneakers', 'cameras_photo',
];
// Categories fetched from backend (those with dedicated recipe feeds)
const FETCH_CATEGORY_KEYS = ['phones', 'electronics', 'gaming', 'vehicles', 'clothing', 'home_garden', 'toys', 'sporting_goods', 'jewelry_watches', 'parts_accessories', 'refurbished', 'beauty_health', 'collectibles', 'audio_music', 'shoes_sneakers', 'cameras_photo'];
// Top 4 shown as promo tiles
const PROMO_CATEGORIES = ALL_HOMEPAGE_CATEGORIES.slice(0, 4);
// Rest shown in bottom grid
const MORE_CATEGORIES = ALL_HOMEPAGE_CATEGORIES.slice(4);

// Luxury/premium keywords to prioritize in trending
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

  // Fetch per-category previews with strict relevance filtering
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
          // Strict relevance filter
          // Don't pre-filter here — buildGrid4 handles filtering with proper exclude-only for dedicated feeds
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

  // ====== UNIFIED SECTION BUILDER (single useMemo, deterministic dedup, guaranteed 4 items) ======
  const { trendingFeed, categoryGrids } = useMemo(() => {
    const dedup = new Set<string>();

    const sortByLuxury = (items: Product[]) =>
      [...items].sort((a, b) => {
        const aLux = LUXURY_KEYWORDS.some(kw => (a.title || '').toLowerCase().includes(kw)) ? 1 : 0;
        const bLux = LUXURY_KEYWORDS.some(kw => (b.title || '').toLowerCase().includes(kw)) ? 1 : 0;
        if (bLux !== aLux) return bLux - aLux;
        return (b.priceUsd || 0) - (a.priceUsd || 0);
      });

    // Helper: pick up to `max` items, strict include+exclude + dedup
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

    // Helper: pick up to `max` items, EXCLUDE-ONLY (no include check) — trusts backend feed
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

    // 2-stage builder: Stage A = exclude-only from dedicated feed, Stage B = strict from accueil
    const buildGrid4 = (catKey: string): Product[] => {
      // Stage A: trust dedicated feed items (backend already categorized them)
      const dedicated = sortByLuxury(categorySections[catKey] || []);
      let items = pickExcludeOnly(dedicated, catKey, 4);
      // Stage B: if < 4, pick from accueil with full strict include+exclude
      if (items.length < 4) {
        items = [...items, ...pickStrict(sortByLuxury(accueilProducts), catKey, 4 - items.length)];
      }
      return items.slice(0, 4);
    };

    // 1) TRENDING (16 items, round-robin luxury-biased from 6 premium cats)
    const trendingCats = ['phones', 'electronics', 'vehicles', 'jewelry_watches', 'gaming', 'clothing', 'audio_music', 'cameras_photo'];
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
    // Fill remaining from accueil — only premium items from appealing categories
    if (trending.length < 16) {
      const trendingAllowedCats = ['phones', 'electronics', 'gaming', 'vehicles', 'jewelry_watches', 'clothing', 'audio_music', 'cameras_photo'];
      const validAccueil = accueilProducts.filter(p => {
        if ((p.priceUsd || 0) < 50) return false;
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

    // 2) ALL CATEGORY GRIDS — every category in ALL_HOMEPAGE_CATEGORIES, guaranteed 4 items
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

  // ====== ASYNC TOP-UP: fetch from catalog-category for grids with <4 items ======
  const [topUpPools, setTopUpPools] = useState<Record<string, Product[]>>({});

  useEffect(() => {
    const shortCats = categoryGrids.filter(g => g.items.length < 4).map(g => g.key);
    if (shortCats.length === 0) return;
    console.debug('[ShopHome] Top-up needed for:', shortCats);
    let cancelled = false;
    (async () => {
      const results = await Promise.allSettled(
        shortCats.map(async (cat) => {
          const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-category', {
            category: cat,
            limit: 120,
            client: 'web',
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
  }, [categoryGrids]);

  // Merge top-up pools into grids (strict filtering)
  const finalCategoryGrids = useMemo(() => {
    if (Object.keys(topUpPools).length === 0) return categoryGrids;
    const usedIds = new Set(categoryGrids.flatMap(g => g.items.map(i => i.id)));
    return categoryGrids.map(g => {
      if (g.items.length >= 4) return g;
      const pool = topUpPools[g.key];
      if (!pool) return g;
      const effectiveExcludes = getEffectiveExcludes(g.key);
      const extra: Product[] = [];
      for (const p of pool) {
        if (g.items.length + extra.length >= 4) break;
        if (usedIds.has(p.id)) continue;
        const titleLower = (p.title || '').toLowerCase();
        // Exclude-only: trust catalog-category backend feed
        if (effectiveExcludes.some(ex => titleLower.includes(ex))) continue;
        extra.push(p);
        usedIds.add(p.id);
      }
      return { key: g.key, items: [...g.items, ...extra].slice(0, 4) };
    });
  }, [categoryGrids, topUpPools]);

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
                {finalCategoryGrids.filter(g => PROMO_CATEGORIES.includes(g.key)).map(({ key: catKey, items }) => (
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

              {/* 5) Remaining Category Grid Cards — all non-promo categories */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {finalCategoryGrids.filter(g => !PROMO_CATEGORIES.includes(g.key)).map(({ key: catKey, items }) => (
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
