import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Flame, ShoppingCart, Check } from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { ShopFooter } from '@/components/shop/ShopFooter';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/formatCurrency';
import { useLanguage } from '@/contexts/LanguageContext';
import { useShopCart } from '@/hooks/useShopCart';
import { toast } from 'sonner';

interface HotProduct {
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

interface Campaign {
  id: string;
  title: string;
  status: string;
  sent_at: string;
  products: HotProduct[];
}

export default function HotProducts() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const { addItem } = useShopCart();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function fetchCampaign() {
      try {
        const { data, error: fetchError } = await supabase
          .from('hot_product_campaigns')
          .select('id, title, status, sent_at, products')
          .eq('status', 'sent')
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        if (fetchError) throw fetchError;
        if (data) {
          setCampaign({
            ...data,
            products: (data.products as unknown as HotProduct[]) || [],
          });
        }
      } catch (err: any) {
        console.error('Failed to fetch hot products campaign:', err);
        setError(err.message || 'Failed to load hot products');
      } finally {
        setLoading(false);
      }
    }
    fetchCampaign();
  }, []);

  const handleAddToCart = async (product: HotProduct) => {
    const key = `${product.provider}-${product.provider_product_id}`;
    if (addingIds.has(key)) return;
    setAddingIds(prev => new Set(prev).add(key));
    try {
      await addItem({
        productId: product.provider_product_id,
        provider: product.provider,
        title: product.title,
        imageUrl: product.image_url,
        priceUsd: product.total_price_usd,
        quantity: 1,
        productUrl: product.product_url || `https://afrishop-usa.com/product/${product.provider}/${product.provider_product_id}`,
      });
      toast.success(
        language === 'fr' ? 'Ajouté au panier !' : 'Added to cart!',
        {
          action: {
            label: language === 'fr' ? 'Voir panier' : 'View Cart',
            onClick: () => navigate('/cart'),
          },
        }
      );
    } catch {
      toast.error(language === 'fr' ? 'Erreur' : 'Failed to add');
    } finally {
      setTimeout(() => {
        setAddingIds(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, 1500);
    }
  };

  const products = campaign?.products?.slice(0, 10) || [];
  const locale = (language === 'fr' || language === 'ln') ? 'fr' : 'en';

  return (
    <div className="min-h-screen bg-black pb-safe-nav">
      <ShopHeader />

      <main className="pt-20 px-3 sm:px-4 pb-24">
        <div className="mx-auto max-w-6xl">
          {/* Back button */}
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
            <div className="relative z-10 flex items-center gap-4">
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
          </motion.div>

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-white/50 animate-spin" />
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="text-center py-20">
              <p className="text-white/50 mb-4">
                {locale === 'fr'
                  ? 'Aucune campagne disponible pour le moment.'
                  : 'No hot products available right now.'}
              </p>
              <Button onClick={() => navigate('/')} variant="outline" className="border-white/20 text-white">
                {locale === 'fr' ? 'Voir la boutique' : 'Browse Shop'}
              </Button>
            </div>
          )}

          {/* Products Grid */}
          {!loading && !error && products.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
              {products.map((product, index) => {
                const key = `${product.provider}-${product.provider_product_id}`;
                const isAdding = addingIds.has(key);

                return (
                  <motion.div
                    key={`${product.provider_product_id}-${index}`}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: index * 0.04 }}
                    className="relative bg-[#1a1d23] border border-white/[0.08] rounded-xl overflow-hidden group hover:border-orange-500/40 transition-all hover:shadow-[0_0_20px_rgba(249,115,22,0.15)]"
                  >
                    {/* Deal Badge */}
                    <div className="absolute top-2 left-2 z-10">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500 text-white text-[10px] font-bold uppercase tracking-wide shadow-lg">
                        <Flame className="w-3 h-3" /> Deal
                      </span>
                    </div>

                    {/* Image - clickable to product page */}
                    <div
                      className="aspect-square bg-white overflow-hidden cursor-pointer"
                      onClick={() => navigate(`/product/${product.provider}/${product.provider_product_id}`)}
                    >
                      <img
                        src={product.image_url}
                        alt={product.title}
                        className="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                    </div>

                    {/* Info */}
                    <div className="p-3 space-y-2">
                      <p
                        className="text-white text-xs sm:text-sm font-medium line-clamp-2 min-h-[2.5rem] cursor-pointer hover:text-orange-300 transition-colors"
                        onClick={() => navigate(`/product/${product.provider}/${product.provider_product_id}`)}
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
                        className={`w-full text-xs h-9 font-bold transition-all ${
                          isAdding
                            ? 'bg-emerald-600 hover:bg-emerald-600 text-white'
                            : 'bg-orange-500 hover:bg-orange-600 text-white'
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddToCart(product);
                        }}
                        disabled={isAdding}
                      >
                        {isAdding ? (
                          <><Check className="w-4 h-4 mr-1" /> {locale === 'fr' ? 'Ajouté !' : 'Added!'}</>
                        ) : (
                          <><ShoppingCart className="w-4 h-4 mr-1" /> {locale === 'fr' ? 'Ajouter au panier' : 'Add to Cart'}</>
                        )}
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && products.length === 0 && (
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
