import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronRight, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { SearchBar } from '@/components/shop/SearchBar';
import { CategoryTabs } from '@/components/shop/CategoryTabs';
import { ProductGrid } from '@/components/shop/ProductGrid';
import { Product } from '@/components/shop/ProductCard';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

interface HomeSection {
  key: string;
  title: string;
  products: Product[];
  seeAllQuery?: string;
}

export default function ShopHome() {
  const [sections, setSections] = useState<HomeSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHomeSections = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase.functions.invoke('catalog-home');
        
        if (error) throw error;
        
        if (data?.sections) {
          const mappedSections: HomeSection[] = data.sections.map((section: any) => ({
            key: section.key,
            title: section.title || section.title_en || section.key,
            seeAllQuery: section.see_all_query || section.key,
            products: (section.items || []).slice(0, 10).map((item: any) => ({
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
  }, []);

  return (
    <div className="min-h-screen bg-black">
      <ShopHeader />
      
      {/* Hero Section */}
      <section className="pt-32 pb-12 px-4">
        <div className="container mx-auto max-w-4xl text-center">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-4"
          >
            Shop the U.S.
            <span className="block bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              Delivered to Africa
            </span>
          </motion.h1>
          
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg text-white/60 mb-8"
          >
            Browse millions of products from Amazon & eBay
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="max-w-xl mx-auto"
          >
            <SearchBar autoFocus className="text-lg" />
          </motion.div>
        </div>
      </section>

      {/* Category Tabs */}
      <section className="px-4 mb-8">
        <div className="container mx-auto">
          <CategoryTabs />
        </div>
      </section>

      {/* Product Sections */}
      <main className="px-4 pb-20">
        <div className="container mx-auto space-y-12">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-white/40" />
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <p className="text-red-400 mb-4">{error}</p>
              <Button 
                onClick={() => window.location.reload()}
                variant="outline"
                className="border-white/20 text-white hover:bg-white/10"
              >
                Try Again
              </Button>
            </div>
          ) : sections.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-white/60">No products available at the moment</p>
            </div>
          ) : (
            sections.map((section, index) => (
              <motion.section
                key={section.key}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.1 }}
              >
                {/* Section Header */}
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl md:text-2xl font-bold text-white">
                    {section.title}
                  </h2>
                  <Link 
                    to={`/shop/search?q=${encodeURIComponent(section.seeAllQuery || section.key)}`}
                    className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    See All
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>

                {/* Products Grid */}
                <ProductGrid products={section.products} />
              </motion.section>
            ))
          )}
        </div>
      </main>

      {/* Footer CTA */}
      <section className="py-16 px-4 border-t border-white/10">
        <div className="container mx-auto text-center">
          <h2 className="text-2xl font-bold text-white mb-4">
            Don't see what you're looking for?
          </h2>
          <p className="text-white/60 mb-6">
            Search for any product from Amazon or eBay
          </p>
          <Link to="/shop/search">
            <Button className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full px-8">
              Search Products
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
