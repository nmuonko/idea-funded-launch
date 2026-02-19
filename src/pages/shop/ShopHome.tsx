import { useState, useEffect, useMemo } from 'react';
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

  // --- Category page state ---
  const [catProducts, setCatProducts] = useState<Product[]>([]);
  const [catLoading, setCatLoading] = useState(false);
  const [catLoadingMore, setCatLoadingMore] = useState(false);
  const [catPage, setCatPage] = useState(1);
  const [catHasMore, setCatHasMore] = useState(true);
  const [catError, setCatError] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  const t = translations[language] || translations.en;
  const shop = t.shop;
  const PAGE_SIZE = 30;

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
  const CATEGORY_KEYS = Object.keys(CATEGORY_TITLE_MAP);

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
        CATEGORY_KEYS.map(async (cat) => {
          const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-home', {
            tab: cat,
            page: 1,
            pageSize: 30,
            client: 'web',
          });
          const items = data?.sections?.[0]?.items?.map(mapItemToProduct).filter(p => p.id && p.priceUsd > 0) || [];
          return { cat, items };
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

  // Build variety feed via round-robin
  const varietyFeed = useMemo(() => {
    const categoryItems = Object.values(categorySections);
    if (categoryItems.length === 0) return accueilProducts;
    const mixed: Product[] = [];
    const seenIds = new Set<string>();
    for (let round = 0; round < 5; round++) {
      for (const catItems of categoryItems) {
        const item = catItems[round];
        if (item && !seenIds.has(item.id)) {
          seenIds.add(item.id);
          mixed.push(item);
        }
      }
    }
    for (const p of accueilProducts) {
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        mixed.push(p);
      }
    }
    return mixed;
  }, [accueilProducts, categorySections]);

  // ====== CATEGORY PAGE DATA ======
  const fetchCategoryPage = async (tab: string, page: number, append: boolean) => {
    if (page === 1) {
      setCatLoading(true);
      setCatError(null);
    } else {
      setCatLoadingMore(true);
    }
    try {
      const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-home', {
        tab,
        page,
        pageSize: PAGE_SIZE,
        client: 'web',
      });
      const items = data?.sections?.[0]?.items?.map(mapItemToProduct).filter(p => p.id && p.priceUsd > 0) || [];
      if (append) {
        setCatProducts(prev => [...prev, ...items]);
      } else {
        setCatProducts(items);
      }
      setCatHasMore(data?.hasMore !== false && items.length >= PAGE_SIZE);
      setCatPage(page);
    } catch (err: any) {
      if (page === 1) setCatError(err.message || 'Failed to load');
    } finally {
      setCatLoading(false);
      setCatLoadingMore(false);
    }
  };

  // ====== EFFECTS ======
  // Load accueil data once
  useEffect(() => {
    fetchAccueilFeed();
    fetchCategorySections();
    loadRecentlyViewed();
  }, [language]);

  useEffect(() => {
    loadRecentlyViewed();
  }, [user?.id]);

  // When active category changes (not accueil), fetch that category
  useEffect(() => {
    if (!isAccueil) {
      setCatProducts([]);
      setCatPage(1);
      setCatHasMore(true);
      fetchCategoryPage(activeCategory, 1, false);
    }
  }, [activeCategory]);

  const handleCatLoadMore = () => {
    if (!catLoadingMore && catHasMore && !isAccueil) {
      fetchCategoryPage(activeCategory, catPage + 1, true);
    }
  };

  const focusSearchBar = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      const searchInput = document.querySelector('header input[type="text"]') as HTMLInputElement;
      if (searchInput) searchInput.focus();
    }, 500);
  };

  const currentLoading = isAccueil ? accueilLoading : catLoading;
  const currentError = isAccueil ? error : catError;

  return (
    <div className="min-h-screen bg-[#111318] pb-20 md:pb-0">
      <ShopHeader />
      <div className="pt-16 md:pt-20" />

      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="mb-6">
        <DeliveryHeroBanner />
      </motion.section>

      <section className="mb-6">
        <div className="container mx-auto px-4">
          <CategoryTabs activeCategory={activeCategory} />
        </div>
      </section>

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
                    <div key={i} className="bg-[#1a1d23] border border-white/[0.1] rounded-2xl p-3 animate-pulse">
                      <div className="aspect-square bg-white/[0.06] rounded-lg mb-2" />
                      <div className="h-3 w-3/4 bg-white/[0.06] rounded mb-1" />
                      <div className="h-3 w-1/2 bg-white/[0.06] rounded" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : currentError ? (
            <div className="text-center py-20">
              <p className="text-red-400 mb-4">{currentError}</p>
              <Button
                onClick={() => isAccueil ? fetchAccueilFeed() : fetchCategoryPage(activeCategory, 1, false)}
                variant="outline"
                className="border-white/20 text-white/90 hover:bg-white/10"
              >
                {shop.tryAgain}
              </Button>
            </div>
          ) : isAccueil ? (
            /* ===== ACCUEIL VIEW ===== */
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="space-y-6">
              {/* Trending horizontal row */}
              {varietyFeed.length > 0 && (
                <SectionBlock
                  title={language === 'fr' ? 'Tendances' : 'Trending Now'}
                  items={varietyFeed}
                  mode="scroll"
                />
              )}

              {/* Recently Viewed */}
              {recentlyViewed.length > 0 && (
                <div className="bg-[#1a1d23] border border-white/[0.1] rounded-2xl p-3 sm:p-4 shadow-md">
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <Clock className="h-4 w-4 text-white/60" />
                    <h2 className="text-lg font-semibold text-white/95">
                      {language === 'fr' ? 'Vus récemment' : 'Recently Viewed'}
                    </h2>
                  </div>
                  <HorizontalProductRow products={recentlyViewed} />
                </div>
              )}

              {/* Category preview cards — rendered ONLY here on Accueil */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {CATEGORY_KEYS.map((catKey) => {
                  const items = categorySections[catKey];
                  if (!items || items.length === 0) return null;
                  return (
                    <SectionBlock
                      key={catKey}
                      title={getCategoryTitle(catKey, language)}
                      items={items}
                      mode="grid"
                      categoryKey={catKey}
                    />
                  );
                })}
                {categoryLoading && Array.from({ length: 4 }).map((_, i) => (
                  <SectionBlock key={`cat-loading-${i}`} items={[]} loading mode="grid" />
                ))}
              </div>
            </motion.div>
          ) : (
            /* ===== CATEGORY VIEW ===== */
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <h2 className="text-xl font-bold text-white/95 mb-4">
                {getCategoryTitle(activeCategory, language)}
              </h2>

              {catProducts.length === 0 ? (
                <p className="text-white/50 text-center py-12">
                  {language === 'fr' ? 'Aucun produit trouvé' : 'No products found'}
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {catProducts.map((product) => (
                      <ProductCard key={`${product.provider}-${product.id}`} product={product} />
                    ))}
                  </div>

                  {catHasMore && (
                    <div className="flex justify-center mt-8">
                      <Button
                        onClick={handleCatLoadMore}
                        variant="outline"
                        className="border-white/20 bg-white/[0.04] text-white/90 hover:bg-white/[0.08] hover:border-white/30 rounded-full px-8 py-3"
                        size="lg"
                        disabled={catLoadingMore}
                      >
                        {catLoadingMore ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            {language === 'fr' ? 'Chargement...' : 'Loading...'}
                          </>
                        ) : (
                          language === 'fr' ? 'Voir plus' : 'Show More'
                        )}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* End of Feed CTA — show on both views */}
          {!currentLoading && (isAccueil ? varietyFeed.length > 0 : catProducts.length > 0) && (
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
