import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Flame, Zap, ChevronLeft, ChevronRight } from 'lucide-react';
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
import { toast } from 'sonner';
import { resizeImageUrl, IMAGE_SIZE_HERO, IMAGE_SIZE_THUMB } from '@/lib/imageResize';
import { filterGalleryImages } from '@/lib/imageValidation';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

interface HotProduct {
  id: string;
  title: string;
  image_url: string;
  total_price_usd: number;
  provider: string;
  provider_product_id: string;
  product_url?: string;
}

interface EnrichedProduct extends HotProduct {
  description?: string;
  gallery: string[];
}

export default function HotProducts() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const { addItem } = useShopCart();
  const { session } = useAuth();
  const [products, setProducts] = useState<EnrichedProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [imageIndexes, setImageIndexes] = useState<Record<string, number>>({});

  const locale = (language === 'fr' || language === 'ln') ? 'fr' : 'en';

  // Fetch hot products then enrich with descriptions + gallery
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
        if (!data?.length) {
          setProducts([]);
          setLoading(false);
          return;
        }

        const base: EnrichedProduct[] = (data as any[]).map(p => ({
          ...p,
          gallery: p.image_url ? [p.image_url] : [],
        }));
        setProducts(base);
        setLoading(false);

        // Enrich each product with description + gallery from catalog API
        for (const product of base) {
          try {
            const normalizedProvider = product.provider?.toLowerCase() === 'rainforest' ? 'amazon' : product.provider;
            const apiUrl = new URL(`${SUPABASE_URL}/functions/v1/catalog-product`);
            apiUrl.searchParams.set('provider', normalizedProvider);
            apiUrl.searchParams.set('id', product.provider_product_id);
            if (normalizedProvider === 'amazon') {
              apiUrl.searchParams.set('amazon_domain', 'amazon.com');
            }

            const resp = await fetch(apiUrl.toString(), {
              headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            });
            if (!resp.ok) continue;
            const json = await resp.json();
            const item = json?.item;
            if (!item) continue;

            const rawImages: string[] = item.images || item.imageUrls || (item.image_url ? [item.image_url] : []);
            const filtered = filterGalleryImages(rawImages);
            const gallery = filtered.length > 0 ? filtered : (product.image_url ? [product.image_url] : []);

            setProducts(prev => prev.map(p =>
              p.id === product.id
                ? { ...p, description: item.description || undefined, gallery }
                : p
            ));
          } catch {
            // Keep original data if enrichment fails
          }
        }
      } catch (err: any) {
        console.error('Failed to fetch hot products:', err);
        setLoading(false);
      }
    }
    fetchProducts();
  }, []);

  const handleBuyNow = async (product: HotProduct) => {
    const key = `${product.provider}-${product.provider_product_id}`;
    if (processingIds.has(key)) return;

    if (!session) {
      const returnUrl = encodeURIComponent(`/hot-products?buy=${product.id}`);
      navigate(`/shop-auth?redirect=${returnUrl}`);
      return;
    }

    setProcessingIds(prev => new Set(prev).add(key));
    try {
      await addItem({
        productId: product.provider_product_id,
        provider: product.provider,
        title: product.title,
        imageUrl: product.image_url,
        priceUsd: product.total_price_usd,
        quantity: 1,
        productUrl: product.product_url || `https://afrishop-usa.com/product/${product.provider}/${product.provider_product_id}`,
        isFixedPrice: true,
      });
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

  // After login redirect: auto-trigger buy
  useEffect(() => {
    if (!session || products.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const buyId = params.get('buy');
    if (!buyId) return;
    const product = products.find(p => p.id === buyId);
    if (product) {
      window.history.replaceState({}, '', '/hot-products');
      handleBuyNow(product);
    }
  }, [session, products]);

  const getImageIndex = (id: string) => imageIndexes[id] || 0;
  const setImageIndex = (id: string, idx: number) =>
    setImageIndexes(prev => ({ ...prev, [id]: idx }));

  return (
    <div className="min-h-screen bg-black pb-safe-nav">
      <ShopHeader />

      <main className="pt-20 px-3 sm:px-4 pb-24">
        <div className="mx-auto max-w-5xl">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/')}
            className="text-white/70 hover:text-white mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {locale === 'fr' ? 'Retour' : 'Back'}
          </Button>

          <h1 className="text-2xl sm:text-3xl font-extrabold text-white mb-6 flex items-center gap-2">
            <Flame className="w-7 h-7 text-orange-400" />
            {locale === 'fr' ? 'Produits Populaires' : 'Hot Products'}
          </h1>

          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-white/50 animate-spin" />
            </div>
          )}

          {!loading && products.length > 0 && (
            <div className="space-y-6">
              {products.map((product, index) => {
                const key = `${product.provider}-${product.provider_product_id}`;
                const isProcessing = processingIds.has(key);
                const imgIdx = getImageIndex(product.id);
                const gallery = product.gallery.length > 0 ? product.gallery : [product.image_url || '/placeholder.svg'];
                const safeIdx = Math.min(imgIdx, gallery.length - 1);

                return (
                  <motion.div
                    key={product.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="bg-[#1a1d23] border border-white/[0.08] rounded-2xl overflow-hidden hover:border-orange-500/30 transition-all"
                  >
                    <div className="flex flex-col md:flex-row">
                      {/* Image Gallery */}
                      <div className="md:w-[380px] flex-shrink-0">
                        <div
                          className="relative aspect-square bg-white cursor-pointer overflow-hidden"
                          onClick={() => navigate(`/product/${product.provider}/${product.provider_product_id}`, {
                            state: {
                              isFixedPrice: true,
                              hotProductPrice: product.total_price_usd,
                              hotProductId: product.id,
                            },
                          })}
                        >
                          <img
                            src={resizeImageUrl(gallery[safeIdx], IMAGE_SIZE_HERO)}
                            alt={product.title}
                            className="w-full h-full object-contain p-4"
                            loading="lazy"
                            onError={(e) => { e.currentTarget.src = '/placeholder.svg'; }}
                          />

                          {gallery.length > 1 && (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); setImageIndex(product.id, (safeIdx - 1 + gallery.length) % gallery.length); }}
                                className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1.5 z-10"
                              >
                                <ChevronLeft className="h-4 w-4" />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setImageIndex(product.id, (safeIdx + 1) % gallery.length); }}
                                className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1.5 z-10"
                              >
                                <ChevronRight className="h-4 w-4" />
                              </button>
                              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                                {gallery.slice(0, 8).map((_, i) => (
                                  <div key={i} className={`w-1.5 h-1.5 rounded-full ${i === safeIdx ? 'bg-orange-400' : 'bg-black/30'}`} />
                                ))}
                                {gallery.length > 8 && <span className="text-[9px] text-black/50 ml-1">+{gallery.length - 8}</span>}
                              </div>
                            </>
                          )}

                          <span className="absolute top-3 left-3 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500 text-white text-[10px] font-bold uppercase tracking-wide shadow-lg z-10">
                            <Flame className="w-3 h-3" /> Deal
                          </span>
                        </div>

                        {/* Thumbnail strip */}
                        {gallery.length > 1 && (
                          <div className="flex gap-1.5 p-2 overflow-x-auto bg-[#1a1d23]">
                            {gallery.slice(0, 8).map((img, i) => (
                              <button
                                key={i}
                                onClick={() => setImageIndex(product.id, i)}
                                className={`flex-shrink-0 w-12 h-12 rounded-md overflow-hidden border-2 transition-all ${
                                  i === safeIdx ? 'border-orange-500' : 'border-white/10 hover:border-white/30'
                                }`}
                              >
                                <img
                                  src={resizeImageUrl(img, IMAGE_SIZE_THUMB)}
                                  alt=""
                                  className="w-full h-full object-contain bg-white p-0.5"
                                  loading="lazy"
                                  onError={(e) => { e.currentTarget.src = '/placeholder.svg'; }}
                                />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Product Info */}
                      <div className="flex-1 p-4 sm:p-6 flex flex-col justify-between min-w-0">
                        <div className="space-y-3">
                          <h2
                            className="text-lg sm:text-xl font-bold text-white cursor-pointer hover:text-orange-300 transition-colors line-clamp-2"
                            onClick={() => navigate(`/product/${product.provider}/${product.provider_product_id}`, {
                              state: {
                                isFixedPrice: true,
                                hotProductPrice: product.total_price_usd,
                                hotProductId: product.id,
                              },
                            })}
                          >
                            {product.title}
                          </h2>

                          <div>
                            <p className="text-orange-400 font-extrabold text-2xl sm:text-3xl">
                              {formatCurrency(product.total_price_usd, { locale: locale as any })}
                            </p>
                            <p className="text-emerald-400/80 text-xs font-medium mt-1">
                              ✓ {locale === 'fr' ? 'Livraison et frais inclus' : 'Shipping & fees included'}
                            </p>
                          </div>

                          {/* Description */}
                          {product.description && (
                            <p className="text-white/60 text-sm leading-relaxed line-clamp-4 whitespace-pre-line">
                              {product.description}
                            </p>
                          )}
                        </div>

                        <div className="mt-4 flex flex-col sm:flex-row gap-3">
                          <Button
                            className="flex-1 h-12 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-full"
                            onClick={(e) => { e.stopPropagation(); handleBuyNow(product); }}
                            disabled={isProcessing}
                          >
                            {isProcessing ? (
                              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {locale === 'fr' ? 'Chargement...' : 'Loading...'}</>
                            ) : (
                              <><Zap className="w-4 h-4 mr-2" /> {locale === 'fr' ? 'Payer maintenant' : 'Pay Now'}</>
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            className="h-12 text-sm font-medium border-white/20 text-white hover:bg-white/10 rounded-full"
                            onClick={() => navigate(`/product/${product.provider}/${product.provider_product_id}`, {
                              state: {
                                isFixedPrice: true,
                                hotProductPrice: product.total_price_usd,
                                hotProductId: product.id,
                              },
                            })}
                          >
                            {locale === 'fr' ? 'Voir détails' : 'View Details'}
                          </Button>
                        </div>
                      </div>
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
