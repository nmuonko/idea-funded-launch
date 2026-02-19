import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Loader2, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { CategoryTabs } from '@/components/shop/CategoryTabs';
import { SectionBlock } from '@/components/shop/SectionBlock';
import { DeliveryHeroBanner } from '@/components/shop/DeliveryHeroBanner';
import { ShopFooter } from '@/components/shop/ShopFooter';
import { HorizontalProductRow } from '@/components/shop/HorizontalProductRow';
import { Product } from '@/components/shop/ProductCard';
import { ProductCard } from '@/components/shop/ProductCard';
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
};

// Relevance keyword whitelists per category (lowercase)
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  phones: ['iphone', 'samsung', 'galaxy', 'pixel', 'phone', 'smartphone', 'android', 'unlocked', 'mobile', 'cellphone', 'téléphone', 'oneplus', 'xiaomi', 'motorola', 'nokia', 'huawei', 'oppo', 'vivo', 'realme'],
  electronics: ['laptop', 'computer', 'tablet', 'monitor', 'headphone', 'speaker', 'camera', 'drone', 'tv', 'television', 'earbuds', 'printer', 'router', 'hard drive', 'ssd', 'ram', 'usb', 'bluetooth', 'wireless', 'electronic', 'smart', 'apple', 'macbook', 'ipad', 'dell', 'hp', 'lenovo', 'asus', 'acer', 'keyboard', 'mouse'],
  gaming: ['ps5', 'playstation', 'xbox', 'nintendo', 'switch', 'gaming', 'console', 'controller', 'pc gamer', 'gpu', 'game', 'jeu', 'gamer', 'steam', 'rtx', 'geforce', 'razer', 'logitech g', 'corsair'],
  vehicles: ['car', 'voiture', 'suv', 'truck', 'pickup', 'toyota', 'honda', 'bmw', 'ford', 'engine', 'gps', 'dash', 'tire', 'auto', 'vehicle', 'motorcycle', 'moto', 'jeep', 'nissan', 'mercedes', 'audi', 'hyundai', 'kia', 'chevrolet'],
  clothing: ['shirt', 'dress', 'pants', 'jacket', 'shoes', 'sneakers', 'boot', 'fashion', 'mode', 'vêtement', 'jeans', 'hoodie', 'coat', 'skirt', 'bag', 'handbag', 'hat', 'cap', 'nike', 'adidas', 'puma', 'zara', 'levi'],
  home_garden: ['sofa', 'couch', 'table', 'chair', 'bed', 'mattress', 'kitchen', 'blender', 'microwave', 'oven', 'fridge', 'refrigerator', 'lamp', 'furniture', 'décor', 'decor', 'garden', 'jardin', 'maison', 'salon', 'curtain', 'rug', 'pillow', 'shelf', 'cabinet', 'desk'],
  toys: ['toy', 'jouet', 'lego', 'doll', 'puzzle', 'action figure', 'barbie', 'nerf', 'playset', 'rc car', 'plush', 'stuffed', 'board game', 'kid', 'enfant', 'children'],
  sporting_goods: ['sport', 'fitness', 'gym', 'yoga', 'running', 'bicycle', 'bike', 'soccer', 'football', 'basketball', 'tennis', 'golf', 'camping', 'hiking', 'outdoor', 'exercise', 'weight', 'dumbbell', 'treadmill'],
  jewelry_watches: ['watch', 'montre', 'bracelet', 'necklace', 'ring', 'earring', 'jewelry', 'bijou', 'gold', 'silver', 'diamond', 'rolex', 'casio', 'seiko', 'fossil', 'pendant'],
  parts_accessories: ['auto part', 'car part', 'brake', 'filter', 'alternator', 'battery', 'headlight', 'bumper', 'mirror', 'wiper', 'spark plug', 'oil', 'transmission', 'radiator', 'pièce', 'accessoire auto'],
  refurbished: ['refurbished', 'renewed', 'reconditioned', 'reconditionné', 'certified', 'pre-owned', 'used', 'occasion'],
};

function isRelevantToCategory(product: Product, categoryKey: string): boolean {
  if (categoryKey === 'all') return true;
  const keywords = CATEGORY_KEYWORDS[categoryKey];
  if (!keywords) return true; // Unknown category, allow all
  const titleLower = (product.title || '').toLowerCase();
  return keywords.some(kw => titleLower.includes(kw));
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

const CATEGORY_POOL_TARGET = 300;
const VISIBLE_STEP = 24;

export default function ShopHome() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  const activeCategory = searchParams.get('tab') || 'all';
  const isAccueil = activeCategory === 'all';

  // --- Accueil state ---
  const [accueilProducts, setAccueilProducts] = useState<Product[]>([]);
  const [accueilLoading, setAccueilLoading] = useState(true);
  const [categorySections, setCategorySections] = useState<Record<string, Product[]>>({});
  const [categoryLoading, setCategoryLoading] = useState(true);
  const [recentlyViewed, setRecentlyViewed] = useState<Product[]>([]);

  // --- Category pool state ---
  const categoryPoolRef = useRef<Record<string, Product[]>>({});
  const [catPoolItems, setCatPoolItems] = useState<Product[]>([]);
  const [catPoolLoading, setCatPoolLoading] = useState(false);
  const [visibleCount, setVisibleCount] = useState(VISIBLE_STEP);

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

  const CATEGORY_KEYS = Object.keys(CATEGORY_TITLE_MAP);

  // ====== FETCH CATEGORY POOL (300 items) ======
  const fetchCategoryPool = useCallback(async (tab: string): Promise<Product[]> => {
    if (categoryPoolRef.current[tab]?.length > 0) {
      return categoryPoolRef.current[tab];
    }

    const accumulated: Product[] = [];
    const seenIds = new Set<string>();
    let page = 1;
    const maxPages = 10;

    while (accumulated.length < CATEGORY_POOL_TARGET && page <= maxPages) {
      const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-home', {
        tab,
        page,
        pageSize: Math.min(100, CATEGORY_POOL_TARGET),
        client: 'web',
      });

      const items = data?.sections?.[0]?.items
        ?.map(mapItemToProduct)
        .filter(p => p.id && p.priceUsd > 0 && !seenIds.has(p.id) && isRelevantToCategory(p, tab)) || [];

      items.forEach(p => {
        seenIds.add(p.id);
        accumulated.push(p);
      });

      if (data?.hasMore === false || items.length === 0) break;
      page++;
    }

    categoryPoolRef.current[tab] = accumulated;
    return accumulated;
  }, []);

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

  // Fetch per-category previews (4 items each, with tab param for correct results)
  const fetchCategorySections = async () => {
    setCategoryLoading(true);
    try {
      const results = await Promise.allSettled(
        CATEGORY_KEYS.map(async (cat) => {
          const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-home', {
            tab: cat,
            page: 1,
            pageSize: 30,
            client: 'web',
          });
          const rawItems = data?.sections?.[0]?.items?.map(mapItemToProduct).filter(p => p.id && p.priceUsd > 0) || [];
          // Apply relevance filtering
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

  // Trending feed — use accueil products directly (not category previews)
  const trendingFeed = useMemo(() => {
    return accueilProducts.slice(0, 20);
  }, [accueilProducts]);

  // Build deduplicated category preview data for Accueil
  // Only dedupe ACROSS categories (not against trending row)
  const deduplicatedCategoryPreviews = useMemo(() => {
    const crossCatSeen = new Set<string>();
    
    const result: Array<{ key: string; items: Product[] }> = [];
    for (const catKey of CATEGORY_KEYS) {
      const items = categorySections[catKey];
      if (!items || items.length === 0) continue;
      
      // Take items not already used by another category, up to 4
      const display: Product[] = [];
      for (const p of items) {
        if (display.length >= 4) break;
        if (!crossCatSeen.has(p.id)) {
          display.push(p);
        }
      }
      // Fallback: if <4 unique, fill from category even if seen elsewhere
      if (display.length < 4) {
        for (const p of items) {
          if (display.length >= 4) break;
          if (!display.some(d => d.id === p.id)) {
            display.push(p);
          }
        }
      }
      
      display.forEach(p => crossCatSeen.add(p.id));
      if (display.length > 0) {
        result.push({ key: catKey, items: display });
      }
    }
    return result;
  }, [categorySections, CATEGORY_KEYS]);

  // ====== EFFECTS ======
  useEffect(() => {
    fetchAccueilFeed();
    fetchCategorySections();
    loadRecentlyViewed();
  }, [language]);

  useEffect(() => {
    loadRecentlyViewed();
  }, [user?.id]);

  // When switching to a category tab, load its pool
  useEffect(() => {
    if (!isAccueil) {
      setVisibleCount(VISIBLE_STEP);
      if (categoryPoolRef.current[activeCategory]?.length > 0) {
        setCatPoolItems(categoryPoolRef.current[activeCategory]);
        setCatPoolLoading(false);
      } else {
        setCatPoolLoading(true);
        setCatPoolItems([]);
        fetchCategoryPool(activeCategory).then(items => {
          setCatPoolItems(items);
          setCatPoolLoading(false);
        }).catch(() => {
          setCatPoolLoading(false);
        });
      }
    }
  }, [activeCategory, fetchCategoryPool]);

  const handleShowMore = () => {
    setVisibleCount(prev => prev + VISIBLE_STEP);
  };

  const focusSearchBar = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      const searchInput = document.querySelector('header input[type="text"]') as HTMLInputElement;
      if (searchInput) searchInput.focus();
    }, 500);
  };

  const currentLoading = isAccueil ? accueilLoading : catPoolLoading;
  const visibleCatProducts = catPoolItems.slice(0, visibleCount);
  const hasMoreToReveal = visibleCount < catPoolItems.length;

  return (
    <div className="min-h-screen bg-[#111318] pb-20 md:pb-0">
      <ShopHeader />
      <div className="pt-16 md:pt-20" />

      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="mb-6">
        <DeliveryHeroBanner />
      </motion.section>


      <main className="pb-8">
        <div className="container mx-auto px-4">
          {currentLoading ? (
            <div className="space-y-4">
              {isAccueil ? (
                <>
                  <SectionBlock items={[]} loading />
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <SectionBlock key={i} items={[]} loading mode="grid" />
                    ))}
                  </div>
                </>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="bg-[#1a1d23] border border-white/10 rounded-2xl p-3 animate-pulse">
                      <div className="aspect-square bg-white/[0.06] rounded-lg mb-2" />
                      <div className="h-3 w-3/4 bg-white/[0.06] rounded mb-1" />
                      <div className="h-3 w-1/2 bg-white/[0.06] rounded" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : error && isAccueil ? (
            <div className="text-center py-20">
              <p className="text-red-400 mb-4">{error}</p>
              <Button onClick={() => fetchAccueilFeed()} variant="outline" className="border-white/20 text-white/90 hover:bg-white/10">
                {shop.tryAgain}
              </Button>
            </div>
          ) : isAccueil ? (
            /* ===== ACCUEIL VIEW ===== */
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="space-y-6">
              {/* Trending row */}
              {trendingFeed.length > 0 && (
                <SectionBlock
                  title={language === 'fr' ? 'Tendances' : 'Trending Now'}
                  items={trendingFeed}
                  mode="scroll"
                />
              )}

              {/* Recently Viewed */}
              {recentlyViewed.length > 0 && (
                <div className="bg-[#1a1d23] border border-white/10 rounded-2xl p-3 sm:p-4 shadow-md">
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <Clock className="h-4 w-4 text-white/60" />
                    <h2 className="text-lg font-semibold text-white/95">
                      {language === 'fr' ? 'Vus récemment' : 'Recently Viewed'}
                    </h2>
                  </div>
                  <HorizontalProductRow products={recentlyViewed} />
                </div>
              )}

              {/* Category preview cards — ONCE per category, deduplicated, 4 items each */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {deduplicatedCategoryPreviews.map(({ key: catKey, items }) => (
                  <SectionBlock
                    key={catKey}
                    title={getCategoryTitle(catKey, language)}
                    items={items}
                    mode="grid"
                    categoryKey={catKey}
                  />
                ))}
                {categoryLoading && Array.from({ length: 4 }).map((_, i) => (
                  <SectionBlock key={`cat-loading-${i}`} items={[]} loading mode="grid" />
                ))}
              </div>
            </motion.div>
          ) : (
            /* ===== CATEGORY VIEW — shows from pre-fetched pool ===== */
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <h2 className="text-xl font-bold text-white/95 mb-4">
                {getCategoryTitle(activeCategory, language)}
              </h2>

              {catPoolItems.length === 0 ? (
                <p className="text-white/50 text-center py-12">
                  {language === 'fr' ? 'Aucun produit trouvé' : 'No products found'}
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                    {visibleCatProducts.map((product) => (
                      <ProductCard key={`${product.provider}-${product.id}`} product={product} />
                    ))}
                  </div>

                  {/* Client-side "Afficher plus" — reveals more from cached pool */}
                  {hasMoreToReveal && (
                    <div className="flex justify-center mt-8">
                      <Button
                        onClick={handleShowMore}
                        variant="outline"
                        className="border-white/20 bg-white/[0.04] text-white/90 hover:bg-white/[0.08] hover:border-white/30 rounded-full px-8 py-3"
                        size="lg"
                      >
                        {language === 'fr' ? 'Afficher plus' : 'Show More'}
                        <span className="ml-2 text-xs text-white/50">
                          ({visibleCount} / {catPoolItems.length})
                        </span>
                      </Button>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* End of Feed CTA — only show once, no "(1/1)" widget */}
          {!currentLoading && !error && (isAccueil ? trendingFeed.length > 0 : catPoolItems.length > 0) && !hasMoreToReveal && (
            <div className="mt-10 py-8 border-t border-white/[0.08]">
              <div className="text-center space-y-4">
                <h3 className="text-lg font-semibold text-white/90">
                  {language === 'fr' ? "Vous ne trouvez pas ce que vous cherchez ?" : "Don't find what you're looking for?"}
                </h3>
                <p className="text-white/50 text-sm">
                  {language === 'fr' ? "Recherchez n'importe quel produit d'Amazon et eBay" : "Search for any product from Amazon & eBay"}
                </p>
                <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className="w-64 mx-auto">
                  <Button
                    onClick={focusSearchBar}
                    className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full px-8 py-3 text-base font-medium"
                    size="lg"
                  >
                    <Search className="h-4 w-4 mr-2" />
                    {language === 'fr' ? 'Rechercher des produits' : 'Search Products'}
                  </Button>
                </motion.div>
              </div>
            </div>
          )}
        </div>
      </main>

      <ShopFooter />
      <BottomNavigation />
    </div>
  );
}
