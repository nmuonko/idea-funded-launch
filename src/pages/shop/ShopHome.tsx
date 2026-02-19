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
  music_instruments: { fr: 'Instruments de Musique', en: 'Music Instruments' },
  beauty_health: { fr: 'Beauté & Santé', en: 'Beauty & Health' },
  collectibles: { fr: 'Collections', en: 'Collectibles' },
};

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  phones: ['iphone', 'samsung galaxy', 'pixel phone', 'smartphone', 'android phone', 'unlocked phone', 'cellphone', 'téléphone', 'oneplus', 'xiaomi phone', 'motorola phone', 'nokia phone', 'huawei phone', 'oppo phone', 'vivo phone', 'realme phone', 'galaxy s2', 'galaxy s3', 'galaxy z', 'galaxy a'],
  electronics: ['laptop', 'computer', 'tablet', 'monitor', 'headphone', 'speaker', 'camera', 'drone', 'television', 'earbuds', 'printer', 'router', 'hard drive', 'ssd', 'gpu', 'cpu', 'bluetooth speaker', 'wireless earbuds', 'macbook', 'ipad', 'dell laptop', 'lenovo', 'asus laptop', 'acer laptop', 'oled tv', 'qled tv', '4k tv', 'smart tv', 'mechanical keyboard', 'webcam', 'projector'],
  gaming: ['ps5', 'playstation', 'xbox', 'nintendo', 'switch oled', 'console', 'video game', 'pc gamer', 'steam deck', 'rtx', 'geforce', 'gaming laptop', 'gaming monitor', 'gaming headset', 'dualsense', 'joycon', 'game disc', 'ps4', 'xbox series'],
  vehicles: ['car ', 'voiture', 'suv ', 'truck ', 'pickup', 'toyota', 'honda', 'bmw', 'ford ', 'vehicle', 'motorcycle', 'moto ', 'jeep', 'nissan', 'mercedes', 'audi', 'hyundai', 'kia ', 'chevrolet', 'land cruiser', 'mustang', 'rav4', 'cr-v', 'sedan', 'coupe', 'convertible', 'minivan'],
  clothing: ['shirt', 'dress', 'pants', 'jacket', 'sneakers', 'boot', 'fashion', 'mode', 'vêtement', 'jeans', 'hoodie', 'coat', 'skirt', 'handbag', 'hat ', 'cap ', 'nike shoe', 'adidas shoe', 'puma shoe', 'levi jeans', 'blouse', 'sweater', 'cardigan', 'trousers'],
  home_garden: ['sofa', 'couch', 'dining table', 'bed frame', 'mattress', 'kitchen appliance', 'blender', 'microwave', 'oven', 'refrigerator', 'lamp', 'furniture', 'garden', 'jardin', 'curtain', 'rug', 'shelf', 'cabinet', 'air conditioner', 'washer', 'dryer', 'dishwasher', 'vacuum', 'coffee maker'],
  toys: ['toy', 'jouet', 'lego', 'doll', 'puzzle', 'action figure', 'barbie', 'nerf', 'playset', 'rc car', 'plush', 'stuffed animal', 'board game', 'play-doh', 'hot wheels'],
  sporting_goods: ['fitness', 'gym equipment', 'yoga mat', 'running shoe', 'bicycle', 'soccer ball', 'football', 'basketball', 'tennis racket', 'golf club', 'camping gear', 'hiking', 'treadmill', 'dumbbell', 'exercise bike', 'kayak', 'garmin'],
  jewelry_watches: ['watch', 'montre', 'bracelet', 'necklace', 'ring', 'earring', 'jewelry', 'bijou', 'gold ', 'silver ', 'diamond', 'rolex', 'casio watch', 'seiko', 'fossil watch', 'pendant', 'luxury watch'],
  parts_accessories: ['auto part', 'car part', 'brake pad', 'oil filter', 'alternator', 'car battery', 'headlight', 'bumper', 'wiper', 'spark plug', 'transmission', 'radiator', 'pièce auto', 'accessoire auto', 'oem part'],
  refurbished: ['refurbished', 'renewed', 'reconditioned', 'reconditionné', 'certified pre-owned', 'factory refurbished'],
  music_instruments: ['guitar', 'piano', 'drum kit', 'violin', 'saxophone', 'trumpet', 'ukulele', 'amplifier', 'synthesizer', 'bass guitar', 'flute', 'harmonica', 'musical instrument', 'acoustic guitar', 'electric guitar', 'drum set'],
  beauty_health: ['perfume', 'cologne', 'skincare', 'makeup', 'lipstick', 'foundation', 'serum', 'moisturizer', 'shampoo', 'hair dryer', 'grooming', 'fragrance', 'beauty', 'cosmetic', 'face cream', 'nail polish'],
  collectibles: ['trading card', 'pokemon card', 'vintage', 'antique', 'collectible', 'memorabilia', 'comic book', 'figurine', 'rare coin', 'stamp collection'],
};

const CATEGORY_EXCLUDE_KEYWORDS: Record<string, string[]> = {
  electronics: ['sofa', 'couch', 'recliner', 'dining', 'bed', 'mattress', 'rug', 'curtain', 'furniture', 'garden', 'pillow', 'décor', 'decor', 'dress', 'shirt', 'pants', 'shoes', 'sneakers', 'toy', 'doll', 'lego', 'kitchen set', 'living room', 'table cloth', 'chair cover', 'bedding', 'comforter', 'blanket', 'yoga', 'exercise', 'workout', 'sport', 'clothing', 'fashion', 'phone case', 'car charger'],
  gaming: ['sofa', 'couch', 'bed', 'mattress', 'furniture', 'kitchen', 'garden', 'dress', 'shirt', 'shoes', 'charger', 'cable', 'fan', 'cooling fan', 'chair', 'desk', 'case', 'skin', 'decal', 'stand', 'mount', 'replacement', 'gaming chair', 'usb-c', 'car charger', 'phone case'],
  phones: ['sofa', 'bed', 'table', 'chair', 'furniture', 'kitchen', 'garden', 'dress', 'shoes', 'mattress', 'case', 'protector', 'screen protector', 'cable', 'charger', 'mount', 'holder', 'stand', 'tempered glass', 'cover', 'wallet', 'strap', 'armband', 'phone case', 'phone mount', 'phone holder', 'phone stand', 'phone charger', 'phone cable', 'car mount'],
  vehicles: ['iphone', 'macbook', 'ps5', 'laptop', 'tablet', 'smartphone', 'dress', 'shirt', 'sofa', 'bed', 'phone', 'charger', 'cable', 'stereo', 'gps', 'carplay', 'android auto', 'dash cam', 'phone mount', 'car charger', 'phone holder', 'bluetooth adapter', 'fm transmitter'],
  clothing: ['iphone', 'ps5', 'macbook', 'laptop', 'tablet', 'sofa', 'couch', 'bed', 'mattress', 'fridge', 'microwave', 'phone case', 'car part'],
  home_garden: ['iphone', 'ps5', 'macbook', 'laptop', 'smartphone', 'playstation', 'xbox', 'nintendo', 'gpu', 'earbuds', 'phone case', 'gaming', 'video game'],
  toys: ['iphone', 'macbook', 'laptop', 'sofa', 'bed', 'mattress', 'ps5', 'vehicle', 'car ', 'phone case'],
  sporting_goods: ['iphone', 'macbook', 'ps5', 'sofa', 'bed', 'mattress', 'laptop', 'tablet', 'phone case', 'gaming'],
  jewelry_watches: ['iphone', 'ps5', 'macbook', 'laptop', 'sofa', 'bed', 'mattress', 'phone case', 'watch band', 'watch strap'],
  parts_accessories: ['iphone', 'macbook', 'ps5', 'laptop', 'dress', 'shirt', 'sofa', 'bed', 'phone case', 'gaming'],
  music_instruments: ['sofa', 'iphone', 'ps5', 'macbook', 'laptop', 'bed', 'mattress', 'phone case', 'gaming', 'keyboard case', 'keyboard cover'],
  beauty_health: ['iphone', 'ps5', 'macbook', 'laptop', 'sofa', 'bed', 'mattress', 'car', 'vehicle', 'phone case', 'gaming'],
  collectibles: ['iphone', 'ps5', 'macbook', 'laptop', 'sofa', 'bed', 'mattress', 'phone case', 'gaming'],
  refurbished: ['sofa', 'bed', 'mattress', 'furniture', 'garden', 'toy', 'doll'],
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

// Categories fetched from backend
const FETCH_CATEGORY_KEYS = ['phones', 'electronics', 'gaming', 'vehicles', 'clothing', 'home_garden', 'toys', 'sporting_goods', 'jewelry_watches', 'parts_accessories', 'refurbished'];
// Top 4 shown as promo tiles
const PROMO_CATEGORIES = FETCH_CATEGORY_KEYS.slice(0, 4);
// Rest shown in bottom grid
const MORE_CATEGORIES = FETCH_CATEGORY_KEYS.slice(4);
// Extra categories sourced from accueil feed via keyword matching (never duplicated with above)
const EXTRA_CATEGORIES = ['music_instruments', 'beauty_health', 'collectibles'];

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
            pageSize: 60,
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

  // ====== UNIFIED SECTION BUILDER (single useMemo, deterministic dedup) ======
  const { trendingFeed, promoPreviews, bottomGridPreviews } = useMemo(() => {
    const dedup = new Set<string>();

    const claim = (items: Product[], max: number): Product[] => {
      const result: Product[] = [];
      for (const p of items) {
        if (result.length >= max) break;
        if (!dedup.has(p.id)) {
          result.push(p);
          dedup.add(p.id);
        }
      }
      return result;
    };

    const sortByLuxury = (items: Product[]) =>
      [...items].sort((a, b) => {
        const aLux = LUXURY_KEYWORDS.some(kw => (a.title || '').toLowerCase().includes(kw)) ? 1 : 0;
        const bLux = LUXURY_KEYWORDS.some(kw => (b.title || '').toLowerCase().includes(kw)) ? 1 : 0;
        if (bLux !== aLux) return bLux - aLux;
        return (b.priceUsd || 0) - (a.priceUsd || 0);
      });

    // 1) TRENDING (16 items, round-robin luxury-biased)
    const trendingCats = ['phones', 'vehicles', 'electronics', 'clothing', 'jewelry_watches', 'gaming', 'sporting_goods', 'home_garden'];
    const trending: Product[] = [];
    for (const cat of trendingCats) {
      const items = sortByLuxury((categorySections[cat] || []).filter(p => isRelevantToCategory(p, cat)));
      let count = 0;
      for (const p of items) {
        if (count >= 2) break;
        if (!dedup.has(p.id)) {
          trending.push(p);
          dedup.add(p.id);
          count++;
        }
      }
    }
    if (trending.length < 16) {
      const remaining = sortByLuxury(accueilProducts);
      for (const p of remaining) {
        if (trending.length >= 16) break;
        if (!dedup.has(p.id)) {
          trending.push(p);
          dedup.add(p.id);
        }
      }
    }

    // 2) PROMO PREVIEWS (top 4 categories, 4 items each)
    const promo: Array<{ key: string; items: Product[] }> = [];
    for (const catKey of PROMO_CATEGORIES) {
      const items = (categorySections[catKey] || []).filter(p => isRelevantToCategory(p, catKey));
      const claimed = claim(items, 4);
      if (claimed.length > 0) promo.push({ key: catKey, items: claimed });
    }

    // 3) MORE CATEGORIES
    const more: Array<{ key: string; items: Product[] }> = [];
    for (const catKey of MORE_CATEGORIES) {
      const items = (categorySections[catKey] || []).filter(p => isRelevantToCategory(p, catKey));
      const claimed = claim(items, 4);
      if (claimed.length > 0) more.push({ key: catKey, items: claimed });
    }

    // 4) EXTRA CATEGORIES from accueil (music, beauty, collectibles)
    const extra: Array<{ key: string; items: Product[] }> = [];
    for (const catKey of EXTRA_CATEGORIES) {
      const matched = accueilProducts.filter(p => isRelevantToCategory(p, catKey));
      const claimed = claim(matched, 4);
      if (claimed.length > 0) extra.push({ key: catKey, items: claimed });
    }

    // 5) Combine bottom grid (more + extra), skip keys already in promo
    const promoKeys = new Set(promo.map(p => p.key));
    const bottom: Array<{ key: string; items: Product[] }> = [];
    for (const entry of [...more, ...extra]) {
      if (!promoKeys.has(entry.key)) {
        bottom.push(entry);
      }
    }

    return {
      trendingFeed: trending.slice(0, 16),
      promoPreviews: promo,
      bottomGridPreviews: bottom,
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
                {promoPreviews.map(({ key: catKey, items }) => (
                  <SectionBlock
                    key={catKey}
                    title={getCategoryTitle(catKey, language)}
                    items={items}
                    mode="grid"
                    categoryKey={catKey}
                  />
                ))}
                {categoryLoading && promoPreviews.length < 4 && Array.from({ length: 4 - promoPreviews.length }).map((_, i) => (
                  <SectionBlock key={`promo-loading-${i}`} items={[]} loading mode="grid" />
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

              {/* 5) More Category Grid Cards — unique categories only, no duplicates */}
              {bottomGridPreviews.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {bottomGridPreviews.map(({ key: catKey, items }) => (
                    <SectionBlock
                      key={catKey}
                      title={getCategoryTitle(catKey, language)}
                      items={items}
                      mode="grid"
                      categoryKey={catKey}
                    />
                  ))}
                </div>
              )}

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
