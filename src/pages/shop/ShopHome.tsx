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
  clothing: ['shirt', 'dress', 'pants', 'jacket', 'sneakers', 'boot', 'vêtement', 'jeans', 'hoodie', 'coat', 'skirt', 'handbag', 'blouse', 'sweater', 'cardigan', 'trousers', 'polo shirt', 'tracksuit', 't-shirt', 'sweatshirt', 'legging'],
  home_garden: ['sofa', 'couch', 'dining table', 'bed frame', 'mattress', 'blender', 'microwave', 'oven', 'refrigerator', 'lamp', 'furniture', 'curtain', 'rug', 'shelf', 'cabinet', 'air conditioner', 'washer', 'dryer', 'dishwasher', 'vacuum', 'coffee maker', 'recliner', 'bookshelf'],
  toys: ['toy', 'jouet', 'lego', 'doll', 'puzzle', 'action figure', 'barbie', 'nerf', 'playset', 'plush', 'stuffed animal', 'board game', 'play-doh', 'hot wheels', 'building blocks', 'toy set'],
  sporting_goods: ['fitness equipment', 'gym equipment', 'yoga mat', 'running shoe', 'bicycle', 'soccer ball', 'basketball', 'tennis racket', 'golf club', 'camping', 'hiking', 'treadmill', 'dumbbell', 'exercise bike', 'kayak', 'garmin watch'],
  jewelry_watches: ['watch ', 'montre', 'bracelet', 'necklace', 'ring ', 'earring', 'jewelry', 'bijou', 'gold necklace', 'gold ring', 'gold bracelet', 'silver necklace', 'silver ring', 'diamond', 'rolex', 'casio watch', 'seiko', 'fossil watch', 'pendant', 'luxury watch', '14k', '18k', '10k gold'],
  parts_accessories: ['auto part', 'car part', 'brake pad', 'oil filter', 'alternator', 'car battery', 'headlight assembly', 'bumper', 'wiper blade', 'spark plug', 'transmission', 'radiator', 'pièce auto', 'oem part', 'catalytic converter'],
  refurbished: ['refurbished', 'renewed', 'reconditioned', 'reconditionné', 'certified pre-owned', 'factory refurbished'],
  beauty_health: ['perfume', 'cologne', 'skincare', 'makeup', 'lipstick', 'foundation', 'serum', 'moisturizer', 'shampoo', 'hair dryer', 'fragrance', 'cosmetic', 'face cream', 'nail polish'],
  collectibles: ['trading card', 'pokemon card', 'vintage', 'antique', 'collectible', 'memorabilia', 'comic book', 'figurine', 'rare coin'],
  audio_music: ['bose', 'sony', 'jbl', 'harman kardon', 'bang & olufsen', 'b&o', 'sennheiser', 'beats', 'marshall', 'speaker', 'subwoofer', 'soundbar', 'home theater', 'amplifier', 'receiver', 'headphones', 'earbuds', 'bluetooth speaker', 'studio monitor', 'pa speaker', 'guitar', 'electric guitar', 'acoustic guitar', 'bass guitar', 'digital piano', 'midi controller', 'drum', 'drum kit', 'microphone', 'audio interface', 'turntable', 'hi-fi', 'surround sound', 'wireless speaker', 'portable speaker'],
  shoes_sneakers: ['nike', 'adidas', 'jordan', 'air max', 'new balance', 'puma', 'reebok', 'converse', 'vans', 'sneakers', 'running shoe', 'basketball shoe', 'yeezy', 'air force 1', 'dunk low', 'dunk high', 'boot', 'loafer', 'sandal', 'trail shoe', 'hiking boot', 'timberland', 'skechers', 'asics', 'under armour'],
  cameras_photo: ['canon', 'nikon', 'sony camera', 'fujifilm', 'gopro', 'dslr', 'mirrorless camera', 'camera lens', 'tripod', 'ring light', 'camera bag', 'drone camera', 'action camera', 'instant camera', 'polaroid', 'digital camera', 'camcorder', 'camera body', 'telephoto lens', 'wide angle lens', 'sony alpha', 'canon eos', 'nikon z'],
};

const CATEGORY_EXCLUDE_KEYWORDS: Record<string, string[]> = {
  electronics: ['sofa', 'couch', 'recliner', 'dining', 'bed', 'mattress', 'rug', 'curtain', 'furniture', 'garden', 'pillow', 'décor', 'decor', 'dress', 'shirt', 'pants', 'shoes', 'sneakers', 'toy', 'doll', 'lego', 'living room', 'bedding', 'comforter', 'blanket', 'yoga', 'exercise', 'workout', 'sport', 'clothing', 'fashion', 'phone case', 'car charger', 'screen protector', 'car touch', 'quad lock', 'mag phone', 'protective case', 'phone mount'],
  gaming: ['sofa', 'couch', 'bed', 'mattress', 'furniture', 'kitchen', 'garden', 'dress', 'shirt', 'shoes', 'charger', 'cable', 'cooling fan', 'internal fan', 'replacement fan', 'gaming chair', 'chair', 'desk', 'skin', 'decal', 'usb-c', 'car charger', 'phone case', 'screen protector', 'for rog ally', 'dock station'],
  phones: ['sofa', 'bed', 'table', 'chair', 'furniture', 'kitchen', 'garden', 'dress', 'shoes', 'mattress', 'case', 'protector', 'screen protector', 'cable', 'charger', 'mount', 'holder', 'stand', 'tempered glass', 'cover', 'wallet', 'strap', 'armband', 'phone case', 'phone mount', 'phone holder', 'phone stand', 'phone charger', 'phone cable', 'car mount', 'film', 'adapter', 'earphones', 'earbuds', 'headphone'],
  vehicles: ['iphone', 'macbook', 'ps5', 'laptop', 'tablet', 'smartphone', 'dress', 'shirt', 'sofa', 'bed', 'charger', 'cable', 'stereo', 'gps', 'carplay', 'android auto', 'dash cam', 'phone mount', 'car charger', 'phone holder', 'bluetooth adapter', 'fm transmitter', 'screen protector', 'touch screen protector', 'tempered glass', 'floor mat', 'seat cover', 'phone', 'head unit', 'radio'],
  clothing: ['iphone', 'ps5', 'macbook', 'laptop', 'tablet', 'sofa', 'couch', 'bed', 'mattress', 'fridge', 'microwave', 'phone case', 'car part', 'charger', 'cable', 'electronic', 'appliance', 'lego', 'toy', 'puzzle', 'doll', 'action figure', 'building block', 'playset', 'yoga mat', 'treadmill', 'dumbbell', 'exercise', 'auto part', 'brake pad', 'oil filter', 'car battery', 'headlight', 'spark plug', 'wiper', 'sofa set', 'dining table', 'refrigerator', 'vacuum', 'blender'],
  home_garden: ['iphone', 'ps5', 'macbook', 'laptop', 'smartphone', 'playstation', 'xbox', 'nintendo', 'gpu', 'earbuds', 'phone case', 'gaming', 'video game', 'console'],
  toys: ['iphone', 'macbook', 'laptop', 'sofa', 'bed', 'mattress', 'ps5', 'phone case', 'charger', 'cable'],
  sporting_goods: ['iphone', 'macbook', 'ps5', 'sofa', 'bed', 'mattress', 'laptop', 'tablet', 'phone case', 'gaming', 'charger', 'cable'],
  jewelry_watches: ['iphone', 'ps5', 'macbook', 'laptop', 'sofa', 'bed', 'mattress', 'phone case', 'charger', 'cable', 'tool', 'appliance', 'furniture'],
  parts_accessories: ['dress', 'shirt', 'sofa', 'bed'],
  beauty_health: ['sofa', 'bed', 'mattress'],
  collectibles: ['sofa', 'bed', 'mattress'],
  audio_music: ['case', 'cover', 'protector', 'screen protector', 'tempered glass', 'mount', 'holder', 'stand', 'adapter', 'replacement', 'spare', 'repair', 'car gps', 'carplay', 'android auto', 'dash cam', 'phone case', 'watch band', 'sofa', 'bed', 'mattress', 'furniture', 'dress', 'shirt', 'toy', 'lego'],
  shoes_sneakers: ['iphone', 'ps5', 'macbook', 'laptop', 'tablet', 'sofa', 'bed', 'mattress', 'phone case', 'charger', 'cable', 'lego', 'toy', 'car part', 'brake pad'],
  cameras_photo: ['sofa', 'bed', 'mattress', 'phone case', 'dress', 'shirt', 'shoes', 'sneakers', 'toy', 'lego', 'car part', 'charger cable'],
  refurbished: [],
};

function isRelevantToCategory(product: Product, categoryKey: string): boolean {
  if (categoryKey === 'all') return true;
  const keywords = CATEGORY_KEYWORDS[categoryKey];
  if (!keywords) return true;
  const titleLower = (product.title || '').toLowerCase();
  // Must match at least one include keyword
  const matches = keywords.some(kw => titleLower.includes(kw));
  if (!matches) return false;
  // Must NOT match any exclude keyword
  const excludes = CATEGORY_EXCLUDE_KEYWORDS[categoryKey];
  if (excludes && excludes.some(ex => titleLower.includes(ex))) return false;
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
          const filtered = rawItems.filter(p => isRelevantToCategory(p, cat));
          return { cat, items: filtered };
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

    // Helper: pick up to `max` items from candidates, applying relevance + dedup
    const pickRelevant = (candidates: Product[], catKey: string, max: number, strictInclude: boolean): Product[] => {
      const result: Product[] = [];
      for (const p of candidates) {
        if (result.length >= max) break;
        if (dedup.has(p.id)) continue;
        const titleLower = (p.title || '').toLowerCase();
        // Always enforce excludes
        const excludes = CATEGORY_EXCLUDE_KEYWORDS[catKey];
        if (excludes?.some(ex => titleLower.includes(ex))) continue;
        // Enforce includes only if strictInclude
        if (strictInclude) {
          const keywords = CATEGORY_KEYWORDS[catKey];
          if (keywords && !keywords.some(kw => titleLower.includes(kw))) continue;
        }
        result.push(p);
        dedup.add(p.id);
      }
      return result;
    };

    // Build category candidate pool: dedicated feed + accueil fallback
    const getCandidates = (catKey: string): Product[] => {
      const dedicated = categorySections[catKey] || [];
      const fromAccueil = accueilProducts.filter(p => isRelevantToCategory(p, catKey));
      // Merge, dedup by id within pool
      const seen = new Set<string>();
      const merged: Product[] = [];
      for (const p of [...dedicated, ...fromAccueil]) {
        if (!seen.has(p.id) && p.id && p.priceUsd > 0) {
          seen.add(p.id);
          merged.push(p);
        }
      }
      return sortByLuxury(merged);
    };

    // Guaranteed 4-item builder for a category
    const buildGrid4 = (catKey: string): Product[] => {
      const candidates = getCandidates(catKey);
      // Step 1: strict include + exclude from merged pool
      let items = pickRelevant(candidates, catKey, 4, true);
      // Step 2: if < 4, try ALL accueil products with strict include (broader pool)
      if (items.length < 4) {
        const moreFromAccueil = pickRelevant(sortByLuxury(accueilProducts), catKey, 4 - items.length, true);
        items = [...items, ...moreFromAccueil];
      }
      // Step 3: if < 4, use dedicated feed items without include check but WITH excludes
      if (items.length < 4) {
        const dedicated = categorySections[catKey] || [];
        const relaxedDedicated = pickRelevant(sortByLuxury(dedicated), catKey, 4 - items.length, false);
        items = [...items, ...relaxedDedicated];
      }
      // Step 4 (emergency): grab unused accueil items, still enforce THIS category's excludes
      if (items.length < 4) {
        const excludes = CATEGORY_EXCLUDE_KEYWORDS[catKey] || [];
        for (const p of sortByLuxury(accueilProducts)) {
          if (items.length >= 4) break;
          if (dedup.has(p.id) || p.priceUsd <= 20) continue;
          const titleLower = (p.title || '').toLowerCase();
          if (excludes.some(ex => titleLower.includes(ex))) continue;
          items.push(p);
          dedup.add(p.id);
        }
      }
      return items.slice(0, 4);
    };

    // 1) TRENDING (16 items, round-robin luxury-biased from 6 premium cats)
    const trendingCats = ['phones', 'electronics', 'vehicles', 'jewelry_watches', 'gaming', 'clothing'];
    const trending: Product[] = [];
    for (const cat of trendingCats) {
      const items = getCandidates(cat);
      let count = 0;
      for (const p of items) {
        if (count >= 2) break;
        if (!dedup.has(p.id)) {
          const titleLower = (p.title || '').toLowerCase();
          const excludes = CATEGORY_EXCLUDE_KEYWORDS[cat];
          if (excludes?.some(ex => titleLower.includes(ex))) continue;
          trending.push(p);
          dedup.add(p.id);
          count++;
        }
      }
    }
    // Fill remaining from accueil — only premium items from appealing categories
    if (trending.length < 16) {
      const trendingAllowedCats = ['phones', 'electronics', 'gaming', 'vehicles', 'jewelry_watches', 'clothing'];
      const validAccueil = accueilProducts.filter(p => {
        if ((p.priceUsd || 0) < 50) return false;
        const title = (p.title || '').toLowerCase();
        return trendingAllowedCats.some(cat => {
          const kws = CATEGORY_KEYWORDS[cat];
          const exs = CATEGORY_EXCLUDE_KEYWORDS[cat];
          return kws?.some(kw => title.includes(kw)) && !exs?.some(ex => title.includes(ex));
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
                {categoryGrids.filter(g => PROMO_CATEGORIES.includes(g.key) && g.items.length > 0).map(({ key: catKey, items }) => (
                  <SectionBlock
                    key={catKey}
                    title={getCategoryTitle(catKey, language)}
                    items={items}
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
                {categoryGrids.filter(g => !PROMO_CATEGORIES.includes(g.key) && g.items.length > 0).map(({ key: catKey, items }) => (
                  <SectionBlock
                    key={catKey}
                    title={getCategoryTitle(catKey, language)}
                    items={items}
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
