import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Loader2, Flame, Zap, Check, MessageCircle, Mail, Home, Search, X } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { ShopFooter } from '@/components/shop/ShopFooter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/formatCurrency';
import { useLanguage } from '@/contexts/LanguageContext';
import { useShopCart } from '@/hooks/useShopCart';
import { useAuth } from '@/contexts/AuthContext';
import { useSupportContact } from '@/hooks/useSupportContact';
import { toast } from 'sonner';
import { SEOHead } from '@/components/SEOHead';

// Escape regex specials for safe highlight matching
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Highlight occurrences of `q` inside `text` (case-insensitive)
const renderHighlighted = (text: string, q: string) => {
  if (!q) return text;
  try {
    const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, 'ig'));
    const lower = q.toLowerCase();
    return parts.map((part, i) =>
      part.toLowerCase() === lower ? (
        <mark key={i} className="bg-orange-400/30 text-orange-200 rounded px-0.5">{part}</mark>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  } catch {
    return text;
  }
};

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
  link_source?: string;
  description_fr?: string | null;
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { language } = useLanguage();
  const { addItem } = useShopCart();
  const { session } = useAuth();
  const { whatsappUrl, emailUrl } = useSupportContact();
  const prefersReducedMotion = useReducedMotion();
  const [products, setProducts] = useState<HotProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  // Search: input value (controlled) + debounced value (used for filtering & URL sync)
  const initialQ = searchParams.get('q') || '';
  const [searchInput, setSearchInput] = useState(initialQ);
  const [searchQuery, setSearchQuery] = useState(initialQ);

  // Debounce input -> searchQuery (250ms)
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Sync debounced query to URL (?q=) so it can be shared / restored
  useEffect(() => {
    const current = searchParams.get('q') || '';
    if (current === searchQuery) return;
    const next = new URLSearchParams(searchParams);
    if (searchQuery) next.set('q', searchQuery);
    else next.delete('q');
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);


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
          const dubai = filtered.filter((p) => p.link_source === 'dubai').sort(sortKey);
          const storefront = filtered.filter((p) => p.link_source !== 'link_generator' && p.link_source !== 'dubai').sort(sortKey);
          const generated = filtered.filter((p) => p.link_source === 'link_generator').sort(sortKey);
          // Order: link-generator (admin-curated featured) first, then storefront, then Dubai (rendered separately).
          setProducts([...generated, ...storefront, ...dubai] as any);
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

  // Track page views once per session — batched & idle to avoid jank on mobile.
  // The previous implementation fired one network insert per product on mount
  // which caused long tasks and visible UI stutter / freezing on mid-range phones.
  useEffect(() => {
    if (products.length === 0) return;
    const viewedFlag = 'hp_views_logged';
    if (sessionStorage.getItem(viewedFlag)) return;
    sessionStorage.setItem(viewedFlag, '1');

    const run = () => {
      // Fire sequentially with small delays so the main thread stays responsive.
      products.slice(0, 60).forEach((p, i) => {
        setTimeout(() => trackClick(p, 'view'), i * 40);
      });
    };
    const idle = (window as any).requestIdleCallback as undefined | ((cb: () => void) => number);
    if (idle) idle(run);
    else setTimeout(run, 300);
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
          <div className="flex items-center gap-2 mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/')}
              className="bg-white/5 border-white/15 text-white hover:bg-white/10 hover:text-white"
            >
              <Home className="w-4 h-4 mr-2" />
              {locale === 'fr' ? "Accueil" : 'Home'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(-1)}
              className="text-white/60 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              {locale === 'fr' ? 'Retour' : 'Back'}
            </Button>
          </div>

          {/* Hero Banner */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden rounded-2xl mb-8 bg-gradient-to-br from-orange-600 via-red-600 to-pink-600 p-6 sm:p-8"
          >
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA4KSIvPjwvc3ZnPg==')] opacity-50" />
            <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 sm:gap-4">
              <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                <div className="flex-shrink-0 w-12 h-12 sm:w-16 sm:h-16 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <Flame className="w-6 h-6 sm:w-9 sm:h-9 text-yellow-300" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-xl sm:text-3xl lg:text-4xl font-extrabold text-white tracking-tight truncate">
                    {locale === 'fr' ? 'Produits Populaires' : 'Hot Products'}
                  </h1>
                  <p className="text-white/80 text-xs sm:text-base mt-1">
                    {locale === 'fr'
                      ? 'Prix tout inclus · Livraison en RDC incluse'
                      : 'All-inclusive pricing · Shipping to DRC included'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <a
                  href={whatsappUrl(session?.user?.email)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="relative group inline-block"
                  aria-label={locale === 'fr' ? 'Contactez-nous sur WhatsApp' : 'Contact us on WhatsApp'}
                >
                  {!prefersReducedMotion && (
                    <span className="absolute inset-0 rounded-full bg-green-400 opacity-60 animate-ping pointer-events-none" aria-hidden="true" />
                  )}
                  <Button
                    size="lg"
                    className={`relative h-11 sm:h-14 px-3 sm:px-6 rounded-full bg-green-500 hover:bg-green-400 text-white font-bold shadow-2xl border-2 border-white gap-2 ${prefersReducedMotion ? '' : 'animate-heartbeat'} group-hover:[animation-play-state:paused] transform-gpu will-change-transform`}
                  >
                    <MessageCircle className="h-5 w-5 sm:h-6 sm:w-6 fill-white" />
                    <span className="hidden sm:inline text-sm">
                      {locale === 'fr' ? 'Problème ? WhatsApp' : 'Need help? WhatsApp'}
                    </span>
                    <span className="sm:hidden text-sm">WhatsApp</span>
                  </Button>
                </a>
                <a
                  href={emailUrl(session?.user?.email)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={locale === 'fr' ? 'Contactez-nous par email' : 'Contact us by email'}
                  className="hidden sm:block"
                >
                  <Button size="icon" className="h-11 w-11 rounded-full bg-white/20 hover:bg-white/30 text-white shadow-lg border-2 border-white/30 backdrop-blur-sm">
                    <Mail className="h-5 w-5" />
                  </Button>
                </a>
              </div>
            </div>

          </motion.div>

          {/* Search bar */}
          <div className="relative mb-6 max-w-xl">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
            <Input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={locale === 'fr' ? 'Rechercher un produit...' : 'Search a product...'}
              className="pl-9 pr-9 h-11 bg-white/[0.04] border-white/10 text-white placeholder:text-white/40 focus-visible:ring-orange-500/50"
              aria-label={locale === 'fr' ? 'Rechercher' : 'Search'}
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => { setSearchInput(''); setSearchQuery(''); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-white/50 hover:text-white hover:bg-white/10"
                aria-label="Clear search"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-white/50 animate-spin" />
            </div>
          )}

          {!loading && (() => {
            const q = searchQuery.trim().toLowerCase();
            const matches = (p: HotProduct) => !q || (p.title || '').toLowerCase().includes(q);
            const dubaiProducts = products.filter(p => p.link_source === 'dubai' && matches(p));
            const regularProducts = products.filter(p => p.link_source !== 'dubai' && matches(p));

            const renderCard = (product: HotProduct, index: number, isDubai: boolean) => {
              const key = `${product.provider}-${product.provider_product_id}`;
              const isProcessing = processingIds.has(key);
              const waMsg = encodeURIComponent(
                `Bonjour AfriShop, j'ai besoin d'aide concernant ce produit: ${product.title}. Lien: ${window.location.origin}/share/hp/${product.id}`
              );
              const waHref = `https://wa.me/243973141627?text=${waMsg}`;
              return (
                <motion.div
                  key={product.id}
                  initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.2, delay: prefersReducedMotion ? 0 : Math.min(index * 0.015, 0.18) }}
                  className="relative bg-[#1a1d23] border border-white/[0.08] rounded-xl overflow-hidden group hover:border-orange-500/40 transition-all hover:shadow-[0_0_20px_rgba(249,115,22,0.15)] transform-gpu"
                >
                  <div className="absolute top-2 left-2 z-10">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500 text-white text-[10px] font-bold uppercase tracking-wide shadow-lg">
                      <Flame className="w-3 h-3" /> {isDubai ? 'Dubai' : 'Deal'}
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
                      {renderHighlighted(cleanProductTitle(product.title), searchQuery.trim())}
                    </p>

                    <div>
                      <p className="text-orange-400 font-extrabold text-lg sm:text-xl leading-tight">
                        {formatCurrency(product.total_price_usd, { locale: locale as any })}
                      </p>
                      <p className="text-emerald-400/80 text-[10px] font-medium mt-0.5">
                        ✓ {locale === 'fr' ? 'Livraison RDC incluse' : 'Shipping to DRC included'}
                      </p>
                      {isDubai && (
                        <p className="text-white/50 text-[10px] mt-0.5">
                          {locale === 'fr' ? 'Livraison estimée 2–4 semaines' : 'Est. delivery 2–4 weeks'}
                        </p>
                      )}
                    </div>

                    <Button
                      size="sm"
                      className="w-full text-xs h-10 font-bold transition-all bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={(e) => {
                        e.stopPropagation();
                        trackClick(product, 'buy_now');
                        handleBuyNow(product);
                      }}
                      disabled={isProcessing}
                    >
                      {isProcessing ? (
                        <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> {locale === 'fr' ? 'Chargement...' : 'Loading...'}</>
                      ) : isDubai ? (
                        <><Zap className="w-4 h-4 mr-1" /> {locale === 'fr' ? 'Commander / Payer' : 'Order / Pay'}</>
                      ) : (
                        <><Zap className="w-4 h-4 mr-1" /> {locale === 'fr' ? 'Payer maintenant' : 'Pay Now'}</>
                      )}
                    </Button>

                    {isDubai && (
                      <a
                        href={waHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="block"
                      >
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full text-[11px] h-9 font-semibold bg-green-600/10 hover:bg-green-600/20 text-green-300 border-green-500/40"
                        >
                          <MessageCircle className="w-3.5 h-3.5 mr-1" />
                          {locale === 'fr' ? 'Problème ? WhatsApp' : 'Need help? WhatsApp'}
                        </Button>
                      </a>
                    )}
                  </div>
                </motion.div>
              );
            };

            return (
              <>
                {regularProducts.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                    {regularProducts.map((p, i) => renderCard(p, i, false))}
                  </div>
                )}

                {dubaiProducts.length > 0 && (
                  <section className="mt-12">
                    <div className="mb-5 border-t border-white/10 pt-8">
                      <h2 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white tracking-tight">
                        🔥 {locale === 'fr' ? 'Articles de Dubai' : 'Items from Dubai'}
                      </h2>
                      <p className="text-white/70 text-sm sm:text-base mt-1">
                        {locale === 'fr'
                          ? 'Livraison RDC incluse · Livraison estimée 2–4 semaines · Vérifié avant expédition'
                          : 'Shipping to DRC included · Est. delivery 2–4 weeks · Verified before shipping'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                      {dubaiProducts.map((p, i) => renderCard(p, i, true))}
                    </div>
                  </section>
                )}

                {regularProducts.length === 0 && dubaiProducts.length === 0 && (
                  <div className="text-center py-20">
                    <Flame className="w-12 h-12 text-white/20 mx-auto mb-4" />
                    <p className="text-white/50">
                      {q
                        ? (locale === 'fr' ? `Aucun produit ne correspond à « ${searchQuery} ».` : `No products match "${searchQuery}".`)
                        : (locale === 'fr' ? 'Aucun produit populaire pour le moment.' : 'No hot products available right now.')}
                    </p>
                    {q && (
                      <Button variant="outline" size="sm" onClick={() => setSearchQuery('')} className="mt-4 bg-white/5 border-white/15 text-white hover:bg-white/10">
                        {locale === 'fr' ? 'Effacer la recherche' : 'Clear search'}
                      </Button>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </main>


      <ShopFooter />
      <BottomNavigation />
    </div>
    </>
  );
}
