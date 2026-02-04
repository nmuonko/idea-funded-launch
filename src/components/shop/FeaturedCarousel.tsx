import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles, Loader2 } from 'lucide-react';

interface FeaturedProduct {
  id: string;
  provider: string;
  title: string;
  imageUrl: string;
  priceUsd: number;
  gradient: string;
  searchQuery: string;
}

const featuredQueries = [
  { query: 'iPhone 16 Pro Max', gradient: 'from-purple-600 via-pink-500 to-red-500' },
  { query: 'luxury car Mercedes BMW', gradient: 'from-amber-500 via-orange-500 to-red-600' },
  { query: 'Xbox Series X', gradient: 'from-green-500 via-emerald-500 to-teal-500' },
  { query: 'Apple Vision Pro', gradient: 'from-slate-400 via-gray-300 to-zinc-400' },
  { query: 'MacBook Pro M4', gradient: 'from-blue-500 via-indigo-500 to-purple-600' },
  { query: 'PlayStation 5', gradient: 'from-blue-600 via-indigo-600 to-violet-600' },
];

export function FeaturedCarousel() {
  const [products, setProducts] = useState<FeaturedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  // Fetch real products
  useEffect(() => {
    const fetchFeaturedProducts = async () => {
      try {
        setLoading(true);
        
        // Fetch one product per query in parallel using GET params
        const results = await Promise.all(
          featuredQueries.map(async ({ query, gradient }) => {
            try {
              const params = new URLSearchParams({
                q: query,
                limit: '1',
              });
              
              const response = await fetch(
                `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/catalog-search?${params}`,
                {
                  headers: {
                    'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                  },
                }
              );
              
              if (!response.ok) return null;
              const data = await response.json();
              
              if (!data?.items?.[0]) return null;
              
              const item = data.items[0];
              return {
                id: item.provider_product_id || item.id,
                provider: item.provider || 'ebay',
                title: item.title || query,
                imageUrl: item.image_url || item.imageUrl || '',
                priceUsd: item.price_usd || item.priceUsd || 0,
                gradient,
                searchQuery: query,
              };
            } catch {
              return null;
            }
          })
        );
        
        const validProducts = results.filter(Boolean) as FeaturedProduct[];
        setProducts(validProducts);
      } catch (err) {
        console.error('Failed to fetch featured products:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchFeaturedProducts();
  }, []);

  // Auto-scroll every 3 seconds
  useEffect(() => {
    if (isPaused || products.length === 0) return;
    
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % products.length);
    }, 3000);
    
    return () => clearInterval(interval);
  }, [isPaused, products.length]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-white/40" />
      </div>
    );
  }

  if (products.length === 0) {
    return null;
  }

  return (
    <div 
      className="relative overflow-hidden py-4"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="container mx-auto">
        {/* Gradient Overlays */}
        <div className="absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-black to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-black to-transparent z-10 pointer-events-none" />
        
        {/* Animated Container */}
        <motion.div
          className="flex gap-4 px-4"
          animate={{
            x: `-${currentIndex * 240}px`,
          }}
          transition={{
            type: 'spring',
            stiffness: 100,
            damping: 20,
          }}
        >
          {/* Duplicate items for infinite scroll effect */}
          {[...products, ...products].map((product, index) => (
            <Link
              key={`${product.id}-${index}`}
              to={`/shop/product/${product.provider}/${encodeURIComponent(product.id)}`}
              className="flex-shrink-0 group"
            >
              <motion.div
                className={`relative w-56 h-44 rounded-2xl bg-gradient-to-br ${product.gradient} p-5 overflow-hidden cursor-pointer`}
                whileHover={{ scale: 1.03, y: -2 }}
                transition={{ type: 'spring', stiffness: 300 }}
              >
                {/* Shimmer Effect */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
                </div>
                
                {/* Large Product Image - Right side, vertically centered */}
                {product.imageUrl && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 w-24 h-24">
                    <img 
                      src={product.imageUrl} 
                      alt={product.title}
                      className="w-full h-full object-contain drop-shadow-2xl"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}
                
                {/* Sparkle Icon */}
                <motion.div
                  animate={{ rotate: [0, 15, -15, 0] }}
                  transition={{ repeat: Infinity, duration: 2 }}
                >
                  <Sparkles className="h-5 w-5 text-white/80" />
                </motion.div>
                
                {/* Content - Left side with text shadow */}
                <div className="relative z-10 h-full flex flex-col justify-end pr-24">
                  <h3 className="text-base font-bold text-white drop-shadow-lg line-clamp-2 leading-tight">
                    {product.title.length > 25 ? product.title.substring(0, 25) + '...' : product.title}
                  </h3>
                  {product.priceUsd > 0 && (
                    <p className="text-lg font-bold text-white mt-1 drop-shadow-lg">
                      ${product.priceUsd.toFixed(2)}
                    </p>
                  )}
                </div>
                
                {/* Decorative Circles */}
                <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
                <div className="absolute -bottom-8 -left-8 w-24 h-24 rounded-full bg-black/20 blur-xl" />
              </motion.div>
            </Link>
          ))}
        </motion.div>
        
        {/* Dots Indicator */}
        <div className="flex justify-center gap-2 mt-4">
          {products.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentIndex(index)}
              className={`w-2 h-2 rounded-full transition-all ${
                index === currentIndex % products.length
                  ? 'bg-blue-500 w-6'
                  : 'bg-white/30 hover:bg-white/50'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
