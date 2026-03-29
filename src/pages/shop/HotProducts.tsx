import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Flame, Zap, Check, MessageCircle, Mail } from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { ShopFooter } from '@/components/shop/ShopFooter';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/formatCurrency';
import { useLanguage } from '@/contexts/LanguageContext';
import { useShopCart } from '@/hooks/useShopCart';
import { useAuth } from '@/contexts/AuthContext';
import { useSupportContact } from '@/hooks/useSupportContact';
import { toast } from 'sonner';

interface HotProduct {
  id: string;
  title: string;
  image_url: string;
  total_price_usd: number;
  provider: string;
  provider_product_id: string;
  price_usd?: number;
  markup_usd?: number;
  shipping_usd?: number;
  product_url?: string;
}

export default function HotProducts() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const { addItem } = useShopCart();
  const { session } = useAuth();
  const { whatsappUrl, emailUrl } = useSupportContact();
  const [products, setProducts] = useState<HotProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function fetchProducts() {
      try {
        const { data, error } = await supabase
          .from('hot_products_showcase')
          .select('*')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .limit(10);

        if (error) throw error;
        if (data) setProducts(data as any);
      } catch (err: any) {
        console.error('Failed to fetch hot products:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchProducts();
  }, []);

  const handleBuyNow = async (product: HotProduct) => {
    const key = `${product.provider}-${product.provider_product_id}`;
    if (processingIds.has(key)) return;

    // If not logged in, redirect to auth with return URL
    if (!session) {
      // Encode product info in the redirect so we can auto-buy after login
      const returnUrl = encodeURIComponent(`/hot-products?buy=${product.id}`);
      navigate(`/shop-auth?redirect=${returnUrl}`);
      return;
    }

    setProcessingIds(prev => new Set(prev).add(key));
    try {
      // Add to cart with admin-set price, then immediately go to checkout
      await addItem({
        productId: product.provider_product_id,
        provider: product.provider,
        title: product.title,
        imageUrl: product.image_url,
        priceUsd: product.total_price_usd,
        quantity: 1,
        productUrl: product.product_url || `https://afrishop-usa.com/product/${product.provider}/${product.provider_product_id}`,
        isFixedPrice: true, // Hot products use admin-set final price, no extra markup/shipping
      });

      // Navigate directly to checkout
      navigate('/checkout');
    } catch {
      toast.error(locale === 'fr' ? 'Erreur, réessayez' : 'Error, please retry');
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  // After login redirect: auto-trigger buy if ?buy= param exists
  useEffect(() => {
    if (!session || products.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const buyId = params.get('buy');
    if (!buyId) return;

    const product = products.find(p => p.id === buyId);
    if (product) {
      // Clean the URL param first
      window.history.replaceState({}, '', '/hot-products');
      handleBuyNow(product);
    }
  }, [session, products]);

  const locale = (language === 'fr' || language === 'ln') ? 'fr' : 'en';

  return (
    <div className="min-h-screen bg-black pb-safe-nav">
      <ShopHeader />

      <main className="pt-20 px-3 sm:px-4 pb-24">
        <div className="mx-auto max-w-6xl">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/')}
            className="text-white/70 hover:text-white mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {locale === 'fr' ? 'Retour' : 'Back'}
          </Button>

          {/* Hero Banner */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden rounded-2xl mb-8 bg-gradient-to-br from-orange-600 via-red-600 to-pink-600 p-6 sm:p-8"
          >
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA4KSIvPjwvc3ZnPg==')] opacity-50" />
            <div className="relative z-10 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex-shrink-0 w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <Flame className="w-8 h-8 sm:w-9 sm:h-9 text-yellow-300" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white tracking-tight">
                    {locale === 'fr' ? '🔥 Produits Populaires' : '🔥 Hot Products'}
                  </h1>
                  <p className="text-white/80 text-sm sm:text-base mt-1">
                    {locale === 'fr'
                      ? 'Prix tout inclus · Livraison en RDC incluse'
                      : 'All-inclusive pricing · Shipping to DRC included'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a href={whatsappUrl(session?.user?.email)} target="_blank" rel="noopener noreferrer">
                  <Button size="icon" className="h-11 w-11 rounded-full bg-green-500 hover:bg-green-400 text-white shadow-lg border-2 border-white/30">
                    <MessageCircle className="h-5 w-5" />
                  </Button>
                </a>
                <a href={emailUrl(session?.user?.email)} target="_blank" rel="noopener noreferrer">
                  <Button size="icon" className="h-11 w-11 rounded-full bg-white/20 hover:bg-white/30 text-white shadow-lg border-2 border-white/30 backdrop-blur-sm">
                    <Mail className="h-5 w-5" />
                  </Button>
                </a>
              </div>
            </div>
          </motion.div>

          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-white/50 animate-spin" />
            </div>
          )}

          {!loading && products.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
              {products.map((product, index) => {
                const key = `${product.provider}-${product.provider_product_id}`;
                const isProcessing = processingIds.has(key);

                return (
                  <motion.div
                    key={product.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.04 }}
                    className="relative bg-[#1a1d23] border border-white/[0.08] rounded-xl overflow-hidden group hover:border-orange-500/40 transition-all hover:shadow-[0_0_20px_rgba(249,115,22,0.15)]"
                  >
                    <div className="absolute top-2 left-2 z-10">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500 text-white text-[10px] font-bold uppercase tracking-wide shadow-lg">
                        <Flame className="w-3 h-3" /> Deal
                      </span>
                    </div>

                    <div
                      className="aspect-square bg-white overflow-hidden cursor-pointer"
                      onClick={() => navigate(`/product/${product.provider}/${product.provider_product_id}`, {
                        state: {
                          isFixedPrice: true,
                          hotProductPrice: product.total_price_usd,
                          hotProductId: product.id,
                        },
                      })}
                    >
                      <img
                        src={product.image_url}
                        alt={product.title}
                        className="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                    </div>

                    <div className="p-3 space-y-2">
                      <p
                        className="text-white text-xs sm:text-sm font-medium line-clamp-2 min-h-[2.5rem] cursor-pointer hover:text-orange-300 transition-colors"
                        onClick={() => navigate(`/product/${product.provider}/${product.provider_product_id}`, {
                          state: {
                            isFixedPrice: true,
                            hotProductPrice: product.total_price_usd,
                            hotProductId: product.id,
                          },
                        })}
                      >
                        {product.title}
                      </p>

                      <div>
                        <p className="text-orange-400 font-extrabold text-lg sm:text-xl leading-tight">
                          {formatCurrency(product.total_price_usd, { locale: locale as any })}
                        </p>
                        <p className="text-emerald-400/80 text-[10px] font-medium mt-0.5">
                          ✓ {locale === 'fr' ? 'Livraison incluse' : 'Shipping included'}
                        </p>
                      </div>

                      <Button
                        size="sm"
                        className="w-full text-xs h-9 font-bold transition-all bg-emerald-600 hover:bg-emerald-700 text-white"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleBuyNow(product);
                        }}
                        disabled={isProcessing}
                      >
                        {isProcessing ? (
                          <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> {locale === 'fr' ? 'Chargement...' : 'Loading...'}</>
                        ) : (
                          <><Zap className="w-4 h-4 mr-1" /> {locale === 'fr' ? 'Payer maintenant' : 'Pay Now'}</>
                        )}
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {!loading && products.length === 0 && (
            <div className="text-center py-20">
              <Flame className="w-12 h-12 text-white/20 mx-auto mb-4" />
              <p className="text-white/50">
                {locale === 'fr'
                  ? 'Aucun produit populaire pour le moment.'
                  : 'No hot products available right now.'}
              </p>
            </div>
          )}
        </div>
      </main>


      <ShopFooter />
      <BottomNavigation />
    </div>
  );
}
