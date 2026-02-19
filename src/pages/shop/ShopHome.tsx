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
}

export default function ShopHome() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [sections, setSections] = useState<Array<{ key: string; title: string; hideTitle?: boolean; items: Product[] }>>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [poolSize, setPoolSize] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLiveMode, setIsLiveMode] = useState(false);

  const activeCategory = searchParams.get('tab') || 'all';

  // Per-category data for Amazon-style grid cards
  const [categorySections, setCategorySections] = useState<Record<string, Product[]>>({});
  const [categoryLoading, setCategoryLoading] = useState(true);

  // Recently viewed
  const [recentlyViewed, setRecentlyViewed] = useState<Product[]>([]);

  const t = translations[language] || translations.en;
  const shop = t.shop;
  
  const PAGE_SIZE = 100;

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

  const fetchFeed = async (page = 1, append = false) => {
    try {
      if (page === 1) {
        setLoading(true);
        setIsLiveMode(false);
        setError(null);
      } else {
        setLoadingMore(true);
      }

      const shouldUseLive = totalPages > 0 && page > totalPages;
      
      const params: Record<string, any> = {
        page,
        pageSize: PAGE_SIZE,
        client: 'web',
      };
      if (shouldUseLive) {
        params.live = '1';
      }
      
      console.log(`[ShopHome] fetching page=${page} shouldUseLive=${shouldUseLive} currentTotalPages=${totalPages}`);
      
      const data = await cachedCatalogFetch<HomeFeedResponse & {
        ok?: boolean;
        error?: string;
        totalPages?: number;
        hasMore?: boolean;
        hasMoreCached?: boolean;
        _meta?: { source?: string; poolSize?: number; isStale?: boolean };
      }>('catalog-home', params);
      
      console.log(`[ShopHome] response page=${page} ok=${data.ok} totalPages=${data.totalPages} poolSize=${data._meta?.poolSize} source=${data._meta?.source}`);
      
      if (data.ok === false) {
        console.warn('[ShopHome] Backend returned ok:false, retrying without cache:', data.error);
        
        if (page === 1 && !append) {
          try {
            const retryData = await cachedCatalogFetch<HomeFeedResponse & {
              ok?: boolean; totalPages?: number; hasMore?: boolean; hasMoreCached?: boolean;
              _meta?: { source?: string; poolSize?: number; isStale?: boolean };
            }>('catalog-home', params, { skipCache: true });
            
            if (retryData.ok !== false && retryData?.sections?.[0]?.items?.length) {
              const mapped = retryData.sections[0].items.map(mapItemToProduct).filter(p => p.id && p.priceUsd > 0);
              setProducts(mapped);
              if (retryData.totalPages) setTotalPages(retryData.totalPages);
              setHasMore(retryData.hasMore !== false && mapped.length > 0);
              setCurrentPage(1);
              return;
            }
          } catch (retryErr) {
            console.warn('[ShopHome] Retry also failed:', retryErr);
          }
          setProducts([]);
          setHasMore(false);
        }
        return;
      }
      
      if (data?.sections?.length) {
        const mappedSections = data.sections
          .map(sec => ({
            key: sec.key,
            title: sec.title,
            hideTitle: sec.hideTitle,
            items: sec.items
              .map(mapItemToProduct)
              .filter(p => p.id && p.priceUsd > 0),
          }))
          .filter(sec => sec.items.length > 0);

        const allProducts = mappedSections.flatMap(s => s.items);
        
        if (append) {
          setProducts(prev => [...prev, ...allProducts]);
          setSections(prev => [...prev, ...mappedSections]);
        } else {
          setProducts(allProducts);
          setSections(mappedSections);
        }
        
        if (data.totalPages !== undefined && data.totalPages > 0) {
          setTotalPages(data.totalPages);
        }
        if (data._meta?.poolSize) {
          setPoolSize(data._meta.poolSize);
        }
        
        const nowLive = data._meta?.source === 'live' || shouldUseLive;
        setIsLiveMode(nowLive);
        setHasMore(data.hasMore !== false && allProducts.length > 0);
        setCurrentPage(page);
      } else if (page === 1) {
        setProducts([]);
        setSections([]);
        setHasMore(false);
      }
    } catch (err: any) {
      console.error('[ShopHome] Network/fetch error:', err);
      if (page === 1) {
        setError(err.message || 'Failed to load products');
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      fetchFeed(currentPage + 1, true);
    }
  };

  // Category keys from admin-configured tabs — use the canonical recipe keys
  const CATEGORY_KEYS = Object.keys(CATEGORY_TITLE_MAP);

  const fetchCategorySections = async () => {
    setCategoryLoading(true);
    try {
      const results = await Promise.allSettled(
        CATEGORY_KEYS.map(async (cat) => {
          // Pass tab=<category> so the backend uses the correct recipe
          const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-home', {
            tab: cat,
            page: 1,
            pageSize: 30,
            client: 'web',
          });
          const items = data?.sections?.[0]?.items?.map(mapItemToProduct).filter(p => p.id && p.priceUsd > 0) || [];
          
          // Debug: log first 3 products per category for verification
          if (items.length > 0) {
            console.log(`[ShopHome] category=${cat} items[0..2]:`, items.slice(0, 3).map(p => p.title));
          }
          
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

  // Load recently viewed
  const loadRecentlyViewed = async () => {
    try {
      const items = await getRecentlyViewed(user?.id, 12);
      setRecentlyViewed(items);
    } catch (err) {
      console.warn('[ShopHome] recently viewed fetch failed', err);
    }
  };

  useEffect(() => {
    fetchFeed(1);
    fetchCategorySections();
    loadRecentlyViewed();
  }, [language]);

  useEffect(() => {
    loadRecentlyViewed();
  }, [user?.id]);

  // Build Accueil variety feed: round-robin from all categories
  const accueilProducts = useMemo(() => {
    const categoryItems = Object.values(categorySections);
    if (categoryItems.length === 0) return products;
    
    const mixed: Product[] = [];
    const seenIds = new Set<string>();
    const maxRounds = 5;
    
    for (let round = 0; round < maxRounds; round++) {
      for (const catItems of categoryItems) {
        const item = catItems[round];
        if (item && !seenIds.has(item.id)) {
          seenIds.add(item.id);
          mixed.push(item);
        }
      }
    }
    
    // Fill with main feed products not already included
    for (const p of products) {
      if (!seenIds.has(p.id)) {
        seenIds.add(p.id);
        mixed.push(p);
      }
    }
    
    return mixed;
  }, [products, categorySections]);

  // Scroll to section when tab is clicked
  const handleCategoryChange = (category: string) => {
    const sectionId = category === 'all' ? 'section-accueil' : `section-${category}`;
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const focusSearchBar = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      const searchInput = document.querySelector('header input[type="text"]') as HTMLInputElement;
      if (searchInput) {
        searchInput.focus();
      }
    }, 500);
  };

  return (
    <div className="min-h-screen bg-[#111318] pb-20 md:pb-0">
      <ShopHeader />
      
      {/* Spacer for fixed header */}
      <div className="pt-16 md:pt-20" />

      {/* Delivery Hero Banner */}
      <motion.section
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="mb-6"
      >
        <DeliveryHeroBanner />
      </motion.section>

      {/* Category Tabs */}
      <section className="mb-6">
        <div className="container mx-auto px-4">
          <CategoryTabs activeCategory={activeCategory} onCategoryChange={handleCategoryChange} />
        </div>
      </section>

      {/* Vertical Category Sections */}
      <main className="pb-8">
        <div className="container mx-auto px-4">
          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <SectionBlock key={i} items={[]} loading />
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <p className="text-red-400 mb-4">{error}</p>
              <Button 
                onClick={() => fetchFeed(1)}
                variant="outline"
                className="border-white/20 text-white/90 hover:bg-white/10"
              >
                {shop.tryAgain}
              </Button>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="space-y-6"
            >
              {/* Accueil — eBay-style mixed variety auto-scrolling feed */}
              {accueilProducts.length > 0 && (
                <div id="section-accueil">
                  <SectionBlock
                    title={language === 'fr' ? 'Tendances' : 'Trending Now'}
                    items={accueilProducts}
                    mode="scroll"
                  />
                </div>
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

              {/* Category cards grid — Amazon style, responsive 4-up */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {CATEGORY_KEYS.map((catKey) => {
                  const items = categorySections[catKey];
                  if (!items || items.length === 0) return null;
                  const catTitle = getCategoryTitle(catKey, language);
                  return (
                    <div key={catKey} id={`section-${catKey}`}>
                      <SectionBlock
                        title={catTitle}
                        items={items}
                        mode="grid"
                        categoryKey={catKey}
                      />
                    </div>
                  );
                })}

                {/* Loading placeholders */}
                {categoryLoading && Array.from({ length: 4 }).map((_, i) => (
                  <SectionBlock key={`cat-loading-${i}`} items={[]} loading mode="grid" />
                ))}
              </div>
            </motion.div>
          )}

          {/* End of Feed CTA */}
          {!loading && products.length > 0 && (
            <div className="mt-10 py-8 border-t border-white/[0.08]">
              <div className="text-center space-y-4">
                <h3 className="text-lg font-semibold text-white/90">
                  {language === 'fr' 
                    ? "Vous ne trouvez pas ce que vous cherchez ?" 
                    : "Don't find what you're looking for?"}
                </h3>
                <p className="text-white/50 text-sm">
                  {language === 'fr'
                    ? "Recherchez n'importe quel produit d'Amazon et eBay"
                    : "Search for any product from Amazon & eBay"}
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className="w-64">
                    <Button 
                      onClick={focusSearchBar}
                      className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full px-8 py-3 text-base font-medium"
                      size="lg"
                    >
                      <Search className="h-4 w-4 mr-2" />
                      {language === 'fr' ? "Rechercher des produits" : "Search Products"}
                    </Button>
                  </motion.div>
                  
                  {hasMore && (
                    <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} className="w-64">
                      <Button
                        onClick={handleLoadMore}
                        variant="outline"
                        className="w-full border-white/20 bg-white/[0.04] backdrop-blur-sm text-white/90 hover:bg-white/[0.08] hover:border-white/30 rounded-full px-8 py-3 text-base font-medium transition-all duration-300"
                        size="lg"
                        disabled={loadingMore}
                      >
                        {loadingMore ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            {language === 'fr' ? "Chargement..." : "Loading..."}
                          </>
                        ) : (
                          <span className="flex items-center gap-3">
                            <span>{language === 'fr' ? 'Voir plus' : 'Show More'}</span>
                            {totalPages > 0 && (
                              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/10 text-white/70">
                                {currentPage} / {Math.min(totalPages, 3)}
                              </span>
                            )}
                          </span>
                        )}
                      </Button>
                    </motion.div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <ShopFooter />

      {/* Bottom Navigation - Mobile Only */}
      <BottomNavigation />
    </div>
  );
}
