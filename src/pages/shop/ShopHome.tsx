import { useState, useEffect } from 'react';
import { ArrowRight, Search, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { CategoryTabs } from '@/components/shop/CategoryTabs';
import { VerticalProductGrid } from '@/components/shop/VerticalProductGrid';
import { DeliveryHeroBanner } from '@/components/shop/DeliveryHeroBanner';
import { ShopFooter } from '@/components/shop/ShopFooter';
import { Product } from '@/components/shop/ProductCard';
import { Button } from '@/components/ui/button';
import { cachedCatalogFetch } from '@/lib/catalogCache';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

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
}

export default function ShopHome() {
  const { language } = useLanguage();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [hasMore, setHasMore] = useState(false);

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

  const fetchFeed = async (page = 1, append = false) => {
    try {
      if (page === 1) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-home', { 
        lang: language,
        page,
        pageSize: 200
      });
      
      if (data?.sections?.[0]?.items) {
        const mappedProducts = data.sections[0].items
          .map(mapItemToProduct)
          .filter(p => p.id && p.priceUsd > 0);
        
        if (append) {
          setProducts(prev => [...prev, ...mappedProducts]);
        } else {
          setProducts(mappedProducts);
        }
        
        setTotalItems(data.totalItems || mappedProducts.length);
        setHasMore(mappedProducts.length > 0 && (data.totalItems || 0) > products.length + mappedProducts.length);
        setCurrentPage(page);
      }
    } catch (err: any) {
      console.error('Failed to fetch home feed:', err);
      setError(err.message || 'Failed to load products');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchFeed(1);
  }, [language]);

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      fetchFeed(currentPage + 1, true);
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
    <div className="min-h-screen bg-black pb-20 md:pb-0">
      <ShopHeader />
      
      {/* Spacer for fixed header */}
      <div className="pt-20" />

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
          <CategoryTabs />
        </div>
      </section>

      {/* Unified Vertical Feed - NO section headers, NO carousels */}
      <main className="pb-8">
        <div className="container mx-auto px-4">
          {loading ? (
            <VerticalProductGrid products={[]} loading skeletonCount={12} />
          ) : error ? (
            <div className="text-center py-20">
              <p className="text-red-400 mb-4">{error}</p>
              <Button 
                onClick={() => fetchFeed(1)}
                variant="outline"
                className="border-white/20 text-white hover:bg-white/10"
              >
                {shop.tryAgain}
              </Button>
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-white/60">{shop.noProducts}</p>
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <VerticalProductGrid products={products} />
            </motion.div>
          )}

          {/* End of Feed CTA */}
          {!loading && products.length > 0 && (
            <div className="mt-10 py-8 border-t border-white/10">
              <div className="text-center space-y-4">
                <h3 className="text-lg font-semibold text-white">
                  {shop.dontSeeWhatYoureLookingFor || "Don't see what you're looking for?"}
                </h3>
                <p className="text-white/60 text-sm">
                  {shop.searchAnyProduct || "Search for any product from Amazon & eBay"}
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  {/* Primary CTA: Search */}
                  <Button 
                    onClick={focusSearchBar}
                    className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full px-8"
                    size="lg"
                  >
                    <Search className="h-4 w-4 mr-2" />
                    {shop.searchProducts || "Search products"}
                  </Button>
                  
                  {/* Secondary: Load More (only if more items exist) */}
                  {hasMore && (
                    <Button
                      onClick={handleLoadMore}
                      variant="outline"
                      className="border-white/20 text-white hover:bg-white/10 rounded-full px-8"
                      size="lg"
                      disabled={loadingMore}
                    >
                      {loadingMore ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        <>
                          <ArrowRight className="h-4 w-4 mr-2" />
                          Load more
                        </>
                      )}
                    </Button>
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
