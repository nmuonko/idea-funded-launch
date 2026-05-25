import { useEffect, useState, useMemo } from 'react';
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
import { SEOHead } from '@/components/SEOHead';

const HP_ADDED_KEY = 'hp_added_';

const buildHotProductUrl = (product: HotProduct) => {
  if (product.product_url) return product.product_url;
  const provider = (product.provider || '').toLowerCase();
  const rawId = product.provider_product_id?.trim();
  if (!rawId) return null;
  if (provider === 'ebay') {
    const ebayItemId = rawId.startsWith('v1|') ? rawId.split('|')[1] || rawId : rawId;
    return `https://www.ebay.com/itm/${ebayItemId}`;
  }
  let cleanId = rawId;
  if (cleanId.toLowerCase().startsWith('amazon_')) cleanId = cleanId.slice(7);
  if (cleanId.toLowerCase().startsWith('rainforest_')) cleanId = cleanId.slice(11);
  return `https://www.amazon.com/dp/${cleanId.toUpperCase()}`;
};

const cleanProductTitle = (title: string): string => {
  if (!title) return title;
  return title.replace(/^\s*Amazon\.com\s*:?\s*/i, '').trim();
};

const REF_STORAGE_KEY = 'afrishop_ref_code';
const REF_CLICK_SESSION_KEY = 'afrishop_ref_click_sent';

interface HotProduct {
  id: string;
  title: string;
  image_url: string;
  gallery_images?: string[] | null;
  total_price_usd: number;
  provider: string;
  provider_product_id: string;
  price_usd?: number;
  markup_usd?: number;
  shipping_usd?: number;
  product_url?: string;
}

// Resolve the best available image: image_url, then first gallery image, then placeholder
const resolveProductImage = (product: HotProduct): string => {
  if (product.image_url) return product.image_url;
  const gallery = product.gallery_images;
  if (Array.isArray(gallery) && gallery.length > 0 && gallery[0]) return gallery[0];
  return '/placeholder.svg';
};

export default function HotProducts() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const { addItem } = useShopCart();
  const { session } = useAuth();
  const { whatsappUrl, emailUrl } = useSupportContact();
  const [products, setProducts] = useState<HotProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  // Handle referral code from URL
  const refCode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('ref');
  }, []);

  useEffect(() => {
    if (!refCode) return;
    // Store ref code for 30 days
    const data = { code: refCode, expires: Date.now() + 30 * 24 * 60 * 60 * 1000 };
    localStorage.setItem(REF_STORAGE_KEY, JSON.stringify(data));
  }, [refCode]);

  useEffect(() => {
    if (!refCode) return;
    const sessionKey = `${REF_CLICK_SESSION_KEY}_${refCode}`;
    if (sessionStorage.getItem(sessionKey)) return;

    const anonSessionId = crypto.randomUUID();
    supabase.rpc('validate_ref_code', { code: refCode })
      .maybeSingle()
      .then(({ data: referrer }) => {
        if (!referrer || referrer.status !== 'active') return;
        supabase.from('referral_events').insert({
          ref_code: refCode,
          event_type: 'click',
          anon_session_id: anonSessionId,
          meta: { user_agent: navigator.userAgent, referrer: document.referrer || null, page: 'hot-products' },
        }).then(() => sessionStorage.setItem(sessionKey, '1'));
      });
  }, [refCode]);

  useEffect(() => {
    async function fetchProducts() {
      try {
        const { data, error } = await (supabase
          .from('hot_products_showcase')
          .select('*') as any)
          .eq('is_active', true)
          .limit(200);

        if (error) throw error;
        if (data) {
          // Admin-curated showcase: show every active item, no client-side price filter.
          const filtered = (data as any[]).filter((item) => Number(item.total_price_usd || 0) > 0);

          // Order matches admin UI: storefront items first (by sort_order asc,
          // then newest first), then link_generator items in the same fashion.
          const sortKey = (a: any, b: any) => {
            const ao = a.sort_order == null ? Number.MAX_SAFE_INTEGER : Number(a.sort_order);
            const bo = b.sort_order == null ? Number.MAX_SAFE_INTEGER : Number(b.sort_order);
            if (ao !== bo) return ao - bo;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          };
          const storefront = filtered.filter((p) => p.link_source !== 'link_generator').sort(sortKey);
          const generated = filtered.filter((p) => p.link_source === 'link_generator').sort(sortKey);
          setProducts([...storefront, ...generated] as any);
        }
      } catch (err: any) {
        console.error('Failed to fetch hot products:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchProducts();
  }, []);

  // Track hot product interactions (fire-and-forget)
  const trackClick = (product: HotProduct, eventType: 'view' | 'click' | 'buy_now') => {
    supabase.from('hot_product_clicks' as any).insert({
      provider_product_id: product.provider_product_id,
      provider: product.provider,
      event_type: eventType,
      source: 'web',
      referrer_code: refCode || null,
      session_id: sessionStorage.getItem('hp_session') || (() => { const s = crypto.randomUUID(); sessionStorage.setItem('hp_session', s); return s; })(),
      user_id: session?.user?.id || null,
    }).then(() => {});
  };

  // Track page views for all products once loaded
  useEffect(() => {
    if (products.length === 0) return;
    products.forEach(p => trackClick(p, 'view'));
  }, [products.length]);

  const handleBuyNow = async (product: HotProduct) => {
    const key = `${product.provider}-${product.provider_product_id}`;
    if (processingIds.has(key)) return;

    setProcessingIds(prev => new Set(prev).add(key));
    try {
      const addedFlag = `${HP_ADDED_KEY}${product.id}`;
      if (!sessionStorage.getItem(addedFlag)) {
        sessionStorage.setItem(addedFlag, '1');
        await addItem({
          productId: product.provider_product_id,
          provider: product.provider,
          title: product.title,
          imageUrl: product.image_url,
          priceUsd: product.total_price_usd,
          quantity: 1,
          productUrl: buildHotProductUrl(product) || `https://www.amazon.com/dp/${product.provider_product_id}`,
          isFixedPrice: true,
        });
      }

      // Guest checkout supported — mirror share/hp flow with ?hp={id}
      navigate(`/checkout?hp=${encodeURIComponent(product.id)}`);
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

  // Support legacy ?buy= links by forwarding to the single-product checkout route
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const buyId = params.get('buy');
    if (!buyId) return;

    navigate(`/hot-products/${buyId}`, { replace: true });
  }, [navigate]);

  const locale = (language === 'fr' || language === 'ln') ? 'fr' : 'en';

  return (
    <>
      <SEOHead title="Hot Products" description="Trending and discounted products handpicked by AfriShop, ready to ship from the USA to DR Congo." />
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
                      onClick={() => {
                        trackClick(product, 'click');
                        navigate(`/share/hp/${product.id}`);
                      }}
                    >
                      <img
                        src={resolveProductImage(product)}
                        alt={cleanProductTitle(product.title)}
                        className="w-full h-full object-contain p-3 group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                        onError={(e) => {
                          const img = e.currentTarget;
                          if (img.src !== window.location.origin + '/placeholder.svg') {
                            img.src = '/placeholder.svg';
                          }
                        }}
                      />
                    </div>

                    <div className="p-3 space-y-2">
                      <p
                        className="text-white text-xs sm:text-sm font-medium line-clamp-2 min-h-[2.5rem] cursor-pointer hover:text-orange-300 transition-colors"
                        onClick={() => {
                          trackClick(product, 'click');
                          navigate(`/share/hp/${product.id}`);
                        }}
                      >
                        {cleanProductTitle(product.title)}
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
                          trackClick(product, 'buy_now');
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
    </>
  );
}
