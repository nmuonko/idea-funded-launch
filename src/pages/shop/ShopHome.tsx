import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { CategoryTabs } from '@/components/shop/CategoryTabs';
import { HorizontalProductRow } from '@/components/shop/HorizontalProductRow';
import { DeliveryHeroBanner } from '@/components/shop/DeliveryHeroBanner';
import { ShopFooter } from '@/components/shop/ShopFooter';
import { Product } from '@/components/shop/ProductCard';
import { Button } from '@/components/ui/button';
import { cachedCatalogFetch } from '@/lib/catalogCache';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

interface HomeSection {
  key: string;
  title: string;
  products: Product[];
  seeAllQuery?: string;
}

export default function ShopHome() {
  const { language } = useLanguage();
  const [sections, setSections] = useState<HomeSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const t = translations[language] || translations.en;
  const shop = t.shop;

  useEffect(() => {
    const fetchHomeSections = async () => {
      try {
        setLoading(true);
        // Use cached fetch for catalog-home (shared across users)
        const data = await cachedCatalogFetch<any>('catalog-home', { lang: language });
        
        if (data?.sections) {
          const mappedSections: HomeSection[] = data.sections.map((section: any) => ({
            key: section.key,
            title: section.title || section.title_en || section.key,
            seeAllQuery: section.see_all_query || section.key,
            products: (section.items || []).slice(0, 12).map((item: any) => ({
              id: item.provider_product_id || item.id,
              provider: item.provider || 'amazon',
              title: item.title || 'Product',
              imageUrl: item.image_url || item.imageUrl || '',
              priceUsd: item.price_usd || item.priceUsd || 0,
              rating: item.rating,
              inStock: item.in_stock !== false,
              productUrl: item.product_url,
            })),
          })).filter((s: HomeSection) => s.products.length > 0);
          
          setSections(mappedSections);
        }
      } catch (err: any) {
        console.error('Failed to fetch home sections:', err);
        setError(err.message || 'Failed to load products');
      } finally {
        setLoading(false);
      }
    };

    fetchHomeSections();
  }, [language]);

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

      {/* Product Sections - Now Horizontal Scrolling */}
      <main className="pb-20">
        <div className="container mx-auto space-y-8">
          {loading ? (
            <div className="space-y-8 px-4">
              {[1, 2, 3].map((i) => (
                <div key={i}>
                  <div className="h-6 w-32 bg-white/10 rounded shimmer mb-4" />
                  <HorizontalProductRow products={[]} loading skeletonCount={6} />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-20 px-4">
              <p className="text-red-400 mb-4">{error}</p>
              <Button 
                onClick={() => window.location.reload()}
                variant="outline"
                className="border-white/20 text-white hover:bg-white/10"
              >
                {shop.tryAgain}
              </Button>
            </div>
          ) : sections.length === 0 ? (
            <div className="text-center py-20 px-4">
              <p className="text-white/60">{shop.noProducts}</p>
            </div>
          ) : (
            sections.map((section, index) => (
              <motion.section
                key={section.key}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
                className="px-4"
              >
                {/* Section Header */}
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg md:text-xl font-bold text-white">
                    {section.title}
                  </h2>
                  <Link 
                    to={`/shop/search?q=${encodeURIComponent(section.seeAllQuery || section.key)}`}
                    className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    {shop.seeAll}
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>

                {/* Horizontal Scrolling Products */}
                <HorizontalProductRow products={section.products} />
              </motion.section>
            ))
          )}
        </div>
      </main>

      {/* Footer CTA */}
      <section className="py-12 px-4 border-t border-white/10">
        <div className="container mx-auto text-center">
          <h2 className="text-xl font-bold text-white mb-3">
            {shop.dontSeeWhatYoureLookingFor}
          </h2>
          <p className="text-white/60 mb-5 text-sm">
            {shop.searchAnyProduct}
          </p>
          <Button 
            onClick={() => {
              window.scrollTo({ top: 0, behavior: 'smooth' });
              setTimeout(() => {
                const searchInput = document.querySelector('header input[type="text"]') as HTMLInputElement;
                if (searchInput) {
                  searchInput.focus();
                }
              }, 500);
            }}
            className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full px-6"
          >
            {shop.searchProducts}
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
      </section>

      {/* Footer */}
      <ShopFooter />

      {/* Bottom Navigation - Mobile Only */}
      <BottomNavigation />
    </div>
  );
}
