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
  phones: ['iphone', 'samsung', 'galaxy', 'pixel', 'phone', 'smartphone', 'android', 'unlocked', 'mobile', 'cellphone', 'téléphone', 'oneplus', 'xiaomi', 'motorola', 'nokia', 'huawei', 'oppo', 'vivo', 'realme'],
  electronics: ['laptop', 'computer', 'tablet', 'monitor', 'headphone', 'speaker', 'camera', 'drone', 'tv', 'television', 'earbuds', 'printer', 'router', 'hard drive', 'ssd', 'ram', 'usb', 'bluetooth', 'wireless', 'electronic', 'macbook', 'ipad', 'dell', 'lenovo', 'asus', 'acer', 'keyboard', 'mouse'],
  gaming: ['ps5', 'playstation', 'xbox', 'nintendo', 'switch', 'gaming', 'console', 'controller', 'pc gamer', 'gpu', 'game', 'jeu', 'gamer', 'steam', 'rtx', 'geforce', 'razer', 'logitech g', 'corsair'],
  vehicles: ['car', 'voiture', 'suv', 'truck', 'pickup', 'toyota', 'honda', 'bmw', 'ford', 'engine', 'gps', 'dash', 'tire', 'auto', 'vehicle', 'motorcycle', 'moto', 'jeep', 'nissan', 'mercedes', 'audi', 'hyundai', 'kia', 'chevrolet'],
  clothing: ['shirt', 'dress', 'pants', 'jacket', 'shoes', 'sneakers', 'boot', 'fashion', 'mode', 'vêtement', 'jeans', 'hoodie', 'coat', 'skirt', 'bag', 'handbag', 'hat', 'cap', 'nike', 'adidas', 'puma', 'zara', 'levi'],
  home_garden: ['sofa', 'couch', 'table', 'chair', 'bed', 'mattress', 'kitchen', 'blender', 'microwave', 'oven', 'fridge', 'refrigerator', 'lamp', 'furniture', 'décor', 'decor', 'garden', 'jardin', 'maison', 'salon', 'curtain', 'rug', 'pillow', 'shelf', 'cabinet', 'desk'],
  toys: ['toy', 'jouet', 'lego', 'doll', 'puzzle', 'action figure', 'barbie', 'nerf', 'playset', 'rc car', 'plush', 'stuffed', 'board game', 'kid', 'enfant', 'children'],
  sporting_goods: ['sport', 'fitness', 'gym', 'yoga', 'running', 'bicycle', 'bike', 'soccer', 'football', 'basketball', 'tennis', 'golf', 'camping', 'hiking', 'outdoor', 'exercise', 'weight', 'dumbbell', 'treadmill'],
  jewelry_watches: ['watch', 'montre', 'bracelet', 'necklace', 'ring', 'earring', 'jewelry', 'bijou', 'gold', 'silver', 'diamond', 'rolex', 'casio', 'seiko', 'fossil', 'pendant'],
  parts_accessories: ['auto part', 'car part', 'brake', 'filter', 'alternator', 'battery', 'headlight', 'bumper', 'mirror', 'wiper', 'spark plug', 'oil', 'transmission', 'radiator', 'pièce', 'accessoire auto'],
  refurbished: ['refurbished', 'renewed', 'reconditioned', 'reconditionné', 'certified', 'pre-owned', 'used', 'occasion'],
  music_instruments: ['guitar', 'piano', 'keyboard', 'drum', 'violin', 'saxophone', 'trumpet', 'ukulele', 'microphone', 'amplifier', 'dj', 'mixer', 'synthesizer', 'bass guitar', 'flute', 'harmonica'],
  beauty_health: ['perfume', 'cologne', 'skincare', 'makeup', 'lipstick', 'foundation', 'serum', 'moisturizer', 'shampoo', 'hair', 'grooming', 'razor', 'fragrance', 'lotion', 'beauty'],
  collectibles: ['coin', 'stamp', 'trading card', 'pokemon', 'vintage', 'antique', 'collectible', 'memorabilia', 'comic', 'figurine', 'medal', 'rare'],
};

const CATEGORY_EXCLUDE_KEYWORDS: Record<string, string[]> = {
  electronics: ['sofa', 'couch', 'table', 'chair', 'bed', 'mattress', 'rug', 'curtain', 'furniture', 'garden', 'pillow', 'décor', 'decor', 'dress', 'shirt', 'pants', 'shoes', 'sneakers', 'toy', 'doll', 'lego'],
  gaming: ['charger', 'case', 'screen protector', 'sofa', 'chair', 'desk', 'table'],
  phones: ['case', 'screen protector', 'charger', 'sofa', 'furniture'],
};

function isRelevantToCategory(product: Product, categoryKey: string): boolean {
  if (categoryKey === 'all') return true;
  const keywords = CATEGORY_KEYWORDS[categoryKey];
  if (!keywords) return true;
  const titleLower = (product.title || '').toLowerCase();
  const matches = keywords.some(kw => titleLower.includes(kw));
  if (!matches) return false;
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

// Split categories into "promo tiles" (first 4) and "more grids" (rest)
// Only use the original 11 categories for fetching; new 3 are keyword-only
const FETCH_CATEGORY_KEYS = ['phones', 'electronics', 'gaming', 'vehicles', 'clothing', 'home_garden', 'toys', 'sporting_goods', 'jewelry_watches', 'parts_accessories', 'refurbished'];
const PROMO_CATEGORIES = FETCH_CATEGORY_KEYS.slice(0, 4);
const MORE_CATEGORIES = FETCH_CATEGORY_KEYS.slice(4);
// New categories that source items from accueil feed via keyword matching
const EXTRA_CATEGORIES = ['music_instruments', 'beauty_health', 'collectibles'];

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

  // Fetch per-category previews (for promo tiles + category grids)
  const fetchCategorySections = async () => {
    setCategoryLoading(true);
    try {
      const results = await Promise.allSettled(
        FETCH_CATEGORY_KEYS.map(async (cat) => {
          const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-home', {
            category: cat,
            page: 1,
            pageSize: 30,
            client: 'web',
          });
          const rawItems = data?.sections?.[0]?.items?.map(mapItemToProduct).filter(p => p.id && p.priceUsd > 0) || [];
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

  // Trending feed — round-robin from all categories for variety
  const trendingFeed = useMemo(() => {
    const categoryOrder = ['phones', 'vehicles', 'electronics', 'clothing', 'jewelry_watches', 'gaming', 'sporting_goods', 'home_garden'];
    const seen = new Set<string>();
    const result: Product[] = [];
    // Round-robin: pick 2 from each category
    for (const cat of categoryOrder) {
      const items = categorySections[cat] || [];
      let count = 0;
      for (const p of items) {
        if (count >= 2) break;
        if (!seen.has(p.id)) {
          result.push(p);
          seen.add(p.id);
          count++;
        }
      }
    }
    // If still under 16, fill from accueilProducts
    for (const p of accueilProducts) {
      if (result.length >= 16) break;
      if (!seen.has(p.id)) {
        result.push(p);
        seen.add(p.id);
      }
    }
    return result.slice(0, 16);
  }, [categorySections, accueilProducts]);

  // Build deduplicated category previews
  const buildCategoryPreviews = (keys: string[]) => {
    const crossCatSeen = new Set<string>();
    const result: Array<{ key: string; items: Product[] }> = [];
    for (const catKey of keys) {
      const items = categorySections[catKey];
      if (!items || items.length === 0) continue;
      const display: Product[] = [];
      for (const p of items) {
        if (display.length >= 4) break;
        if (!crossCatSeen.has(p.id)) display.push(p);
      }
      if (display.length < 4) {
        for (const p of items) {
          if (display.length >= 4) break;
          if (!display.some(d => d.id === p.id)) display.push(p);
        }
      }
      display.forEach(p => crossCatSeen.add(p.id));
      if (display.length > 0) result.push({ key: catKey, items: display });
    }
    return result;
  };

  // Build extra category previews from accueil products via keyword matching
  const extraPreviews = useMemo(() => {
    const shownKeys = new Set([...PROMO_CATEGORIES, ...MORE_CATEGORIES]);
    const result: Array<{ key: string; items: Product[] }> = [];
    for (const catKey of EXTRA_CATEGORIES) {
      if (shownKeys.has(catKey)) continue;
      const matched = accueilProducts.filter(p => isRelevantToCategory(p, catKey)).slice(0, 4);
      if (matched.length > 0) result.push({ key: catKey, items: matched });
    }
    return result;
  }, [accueilProducts]);

  const promoPreviews = useMemo(() => buildCategoryPreviews(PROMO_CATEGORIES), [categorySections]);
  const morePreviews = useMemo(() => buildCategoryPreviews(MORE_CATEGORIES), [categorySections]);

  // Combine more + extra for the bottom grid, then pad to fill rows of 4
  const bottomGridPreviews = useMemo(() => {
    const combined = [...morePreviews, ...extraPreviews];
    // Deduplicate by key
    const seen = new Set<string>();
    const unique = combined.filter(({ key }) => {
      // Also exclude promo keys
      if (PROMO_CATEGORIES.includes(key)) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return unique;
  }, [morePreviews, extraPreviews]);

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
              {/* Promo skeleton */}
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

              {/* 2) Trending Grid (static, right after hero) */}
              {trendingFeed.length > 0 && (
                <SectionBlock
                  title={language === 'fr' ? 'Tendances' : 'Trending Now'}
                  items={trendingFeed}
                  mode="static-grid"
                  seeAllLink="/category/all"
                />
              )}

              {/* 3) Promo Tiles — top 4 categories (Amazon-style 2x2 thumbnail cards) */}
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

              {/* 5) More Category Grid Cards — unique categories, no duplicates */}
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

              {/* End of feed — no CTA */}
            </motion.div>
          )}
        </div>
      </main>

      <ShopFooter />
      <BottomNavigation />
    </div>
  );
}
