import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Flame, Zap, MessageCircle, Mail, Home, Search, TrendingUp, Sparkles, X, Eye } from 'lucide-react';

import { motion, useReducedMotion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { BrandLogo } from '@/components/shop/BrandLogo';
import { ShopFooter } from '@/components/shop/ShopFooter';
import { Button } from '@/components/ui/button';
import { ProductCardSkeleton } from '@/components/shop/ProductCardSkeleton';
import { supabase } from '@/integrations/supabase/client';
import { recoverFromStaleBundle } from '@/lib/cacheBust';
import { formatCurrency } from '@/lib/formatCurrency';
import { useLanguage } from '@/contexts/LanguageContext';
import { useShopCart } from '@/hooks/useShopCart';
import { useAuth } from '@/contexts/AuthContext';
import { useSupportContact } from '@/hooks/useSupportContact';
import { toast } from 'sonner';
import { SEOHead } from '@/components/SEOHead';
import { useAfriShopChatbot } from '@/contexts/AfriShopChatbotContext';

const HP_ADDED_KEY = 'hp_added_';

// ---------------- i18n ----------------
type HPLocale = 'en' | 'fr';
const HP_STRINGS = {
  en: {
    pageTitle: 'Hot Products',
    pageDescription: 'Trending and discounted products handpicked by AfriShop, ready to ship from the USA to DR Congo.',
    home: 'Home',
    heroTitle: 'Hot Products',
    heroSubtitle: 'All-inclusive pricing · Shipping to DRC included',
    whatsappLong: 'Need help? WhatsApp',
    whatsapp: 'WhatsApp',
    whatsappAria: 'Contact us on WhatsApp',
    emailAria: 'Contact us by email',
    deal: 'Deal',
    dubai: 'Dubai',
    shippingIncluded: 'Shipping to DRC included',
    estDelivery: 'Est. delivery 2–4 weeks',
    loading: 'Loading...',
    payNow: 'Pay Now',
    orderNow: 'Order Now',
    error: 'Error, please retry',
    dubaiSectionTitle: 'Items from Dubai',
    dubaiSectionSubtitle: 'Shipping to DRC included · Est. delivery 2–4 weeks · Verified before shipping',
    empty: 'No hot products available right now.',
    searchPlaceholder: 'Search hot products...',
    noResults: 'No products match your search.',
    clearSearch: 'Clear',
    sortLabel: 'Sort:',
    sortFeatured: 'Featured',
    sortPriceAsc: 'Price: low to high',
    sortPriceDesc: 'Price: high to low',
    sectionTrending: '🔥 Trending now',
    countItems: (n: number) => `${n} item${n === 1 ? '' : 's'}`,
    floatingHelp: 'Need help?',

    waMessage: (details: { title: string; summary: string; price: string; ref: string; image: string; link: string }) =>
      `Bonjour L'Équipe AfriShop\nJe suis prêt à acheter ce produit : ${details.title} - ${details.link}.\n\nPouvez-vous confirmer sa disponibilité avant le paiement ?`,
  },
  fr: {
    pageTitle: 'Produits Populaires',
    pageDescription: "Produits tendance et en promotion sélectionnés par AfriShop, prêts à expédier des USA vers la RDC.",
    home: 'Accueil',
    heroTitle: 'Produits Populaires',
    heroSubtitle: 'Prix tout inclus · Livraison en RDC incluse',
    whatsappLong: 'Problème ? WhatsApp',
    whatsapp: 'WhatsApp',
    whatsappAria: 'Contactez-nous sur WhatsApp',
    emailAria: 'Contactez-nous par email',
    deal: 'Promo',
    dubai: 'Dubai',
    shippingIncluded: 'Livraison RDC incluse',
    estDelivery: 'Livraison estimée 2–4 semaines',
    loading: 'Chargement...',
    payNow: 'Payer maintenant',
    orderNow: 'Commander',
    error: 'Erreur, réessayez',
    dubaiSectionTitle: 'Articles de Dubai',
    dubaiSectionSubtitle: 'Livraison RDC incluse · Livraison estimée 2–4 semaines · Vérifié avant expédition',
    empty: 'Aucun produit populaire pour le moment.',
    searchPlaceholder: 'Rechercher un produit...',
    noResults: 'Aucun produit ne correspond à votre recherche.',
    clearSearch: 'Effacer',
    sortLabel: 'Trier :',
    sortFeatured: 'En vedette',
    sortPriceAsc: 'Prix : croissant',
    sortPriceDesc: 'Prix : décroissant',
    sectionTrending: '🔥 Tendances',
    countItems: (n: number) => `${n} article${n === 1 ? '' : 's'}`,
    floatingHelp: 'Besoin d\'aide ?',

    waMessage: (details: { title: string; summary: string; price: string; ref: string; image: string; link: string }) =>
      `Bonjour L'Équipe AfriShop\nJe suis prêt à acheter ce produit : ${details.title} - ${details.link}.\n\nPouvez-vous confirmer sa disponibilité avant le paiement ?`,
  },
} as const;

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
const SHARE_PREVIEW_BASE_URL = `${import.meta.env.VITE_SUPABASE_URL || 'https://igmkhxffnyzoogcqvdab.supabase.co'}/functions/v1/share-og`;

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

const resolveProductImage = (product: HotProduct): string => {
  if (product.image_url) return product.image_url;
  const gallery = product.gallery_images;
  if (Array.isArray(gallery) && gallery.length > 0 && gallery[0]) return gallery[0];
  return '/placeholder.svg';
};

// Shared focus ring class for keyboard a11y on dark backgrounds
const FOCUS_RING =
  'focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#15181d]';

export default function HotProducts() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const { addItem } = useShopCart();
  const { session } = useAuth();
  const { whatsapp, whatsappUrl, emailUrl } = useSupportContact();
  const prefersReducedMotion = useReducedMotion();
  const { open: openChatbot } = useAfriShopChatbot();
  const [products, setProducts] = useState<HotProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'featured' | 'price_asc' | 'price_desc'>('featured');
  const [brandFilter, setBrandFilter] = useState<'iphone' | 'samsung' | 'pixel'>('iphone');
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({});


  const locale: HPLocale = (language === 'fr' || language === 'ln') ? 'fr' : 'en';
  const t = HP_STRINGS[locale];
  const heroWhatsappUrl = `https://wa.me/${whatsapp.replace(/[^0-9]/g, '')}`;

  const BRAND_CHIPS: { key: 'iphone' | 'samsung' | 'pixel'; label: string; match: (t: string) => boolean }[] = [
    { key: 'iphone', label: 'iPhone', match: (t) => /iphone|apple/i.test(t) },
    { key: 'samsung', label: 'Samsung', match: (t) => /samsung|galaxy/i.test(t) },
    { key: 'pixel', label: 'Google Pixel', match: (t) => /pixel/i.test(t) },
  ];

  // Handle referral code from URL
  const refCode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('ref');
  }, []);

  useEffect(() => {
    if (!refCode) return;
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
          .select('id, title, image_url, total_price_usd, product_url, provider, provider_product_id, sort_order, is_active, created_at, updated_at, link_source, description_fr, gallery_images') as any)
          .eq('is_active', true)
          .limit(200);

        if (error) throw error;
        if (data) {
          const filtered = (data as any[]).filter((item) => Number(item.total_price_usd || 0) > 0);
          // Strict admin order: sort_order ASC, then most-recent first as tiebreaker.
          // No source-bucketing — the order shown in the admin portal is the order shown here.
          filtered.sort((a, b) => {
            const ao = a.sort_order == null ? Number.MAX_SAFE_INTEGER : Number(a.sort_order);
            const bo = b.sort_order == null ? Number.MAX_SAFE_INTEGER : Number(b.sort_order);
            if (ao !== bo) return ao - bo;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          });
          setProducts(filtered as any);
        }
      } catch (err: any) {
        console.error('Failed to fetch hot products:', err);
        // Permission errors on removed columns mean the user is running a stale JS bundle
        // (post-migration the cost columns were revoked). Force a cache-bust reload.
        const code = err?.code || '';
        const msg = String(err?.message || '');
        if (code === '42501' || /permission denied|column .* does not exist/i.test(msg)) {
          recoverFromStaleBundle();
          return;
        }
      } finally {
        setLoading(false);
      }
    }
    fetchProducts();
  }, []);

  // Fetch aggregated view counts per hot product
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await (supabase as any).rpc('get_hot_product_view_counts');
        if (error || !data || cancelled) return;
        const map: Record<string, number> = {};
        for (const row of data as Array<{ provider: string; provider_product_id: string; views: number }>) {
          if (!row.provider_product_id) continue;
          map[`${row.provider}:${row.provider_product_id}`] = Number(row.views) || 0;
        }
        setViewCounts(map);
      } catch {
        // non-critical
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const trackClick = (product: HotProduct, eventType: 'view' | 'click' | 'buy_now') => {
    // Optimistically increment local view counter on any user-initiated click
    if (eventType === 'click' || eventType === 'buy_now') {
      const k = `${product.provider}:${product.provider_product_id}`;
      setViewCounts((prev) => ({ ...prev, [k]: (prev[k] || 0) + 1 }));
    }
    // Persist as a 'view' for clicks so the aggregated count reflects engagement
    const persistedType = eventType === 'click' ? 'view' : eventType;
    supabase.from('hot_product_clicks' as any).insert({
      provider_product_id: product.provider_product_id,
      provider: product.provider,
      event_type: persistedType,
      source: 'web',
      referrer_code: refCode || null,
      session_id: sessionStorage.getItem('hp_session') || (() => { const s = crypto.randomUUID(); sessionStorage.setItem('hp_session', s); return s; })(),
      user_id: session?.user?.id || null,
    }).then(() => {});
  };

  useEffect(() => {
    if (products.length === 0) return;
    const viewedFlag = 'hp_views_logged';
    if (sessionStorage.getItem(viewedFlag)) return;
    sessionStorage.setItem(viewedFlag, '1');

    const run = () => {
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

      navigate(`/checkout?hp=${encodeURIComponent(product.id)}`);
    } catch {
      toast.error(t.error);
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const buyId = params.get('buy');
    if (!buyId) return;
    navigate(`/hot-products/${buyId}`, { replace: true });
  }, [navigate]);

  return (
    <>
      <SEOHead title={t.pageTitle} description={t.pageDescription} />
    <div className="min-h-screen bg-[#fbf1de] pb-safe-nav">
      <ShopHeader />

      <main className="pt-20 px-3 sm:px-4 pb-24">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center gap-2 mb-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/')}
              className={`bg-white/5 border-white/15 text-white hover:bg-white/10 hover:text-white ${FOCUS_RING}`}
            >
              <Home className="w-4 h-4 mr-2" aria-hidden="true" />
              {t.home}
            </Button>
          </div>

          {/* Hero Banner — slim */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="relative overflow-hidden rounded-2xl mb-3 bg-gradient-to-br from-orange-600 via-red-600 to-pink-600 px-4 py-3 sm:px-6 sm:py-4"
          >
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA4KSIvPjwvc3ZnPg==')] opacity-50" aria-hidden="true" />
            <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="flex-shrink-0 w-11 h-11 sm:w-14 sm:h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                  <Flame className="w-5 h-5 sm:w-7 sm:h-7 text-yellow-300" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h1 className="text-lg sm:text-2xl lg:text-3xl font-extrabold text-white tracking-tight truncate">
                    {t.heroTitle}
                  </h1>
                  <p className="text-white/85 text-xs sm:text-sm mt-0.5">{t.heroSubtitle}</p>
                </div>
              </div>
              <a
                href={emailUrl(session?.user?.email)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t.emailAria}
                className={`hidden sm:block rounded-full ${FOCUS_RING}`}
              >
                <Button size="icon" className="h-10 w-10 rounded-full bg-white/20 hover:bg-white/30 text-white shadow-lg border-2 border-white/30 backdrop-blur-sm" tabIndex={-1}>
                  <Mail className="h-4 w-4" aria-hidden="true" />
                </Button>
              </a>
            </div>
          </motion.div>

          {/* Sticky Filter / Sort Bar */}
          {!loading && products.length > 0 && (
            <div className="sticky top-16 z-30 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2 mb-3 bg-black/85 backdrop-blur-md border-b border-white/10">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-2 overflow-x-auto flex-1 min-w-0">
                  {BRAND_CHIPS.map((chip) => {
                    const active = brandFilter === chip.key;
                    return (
                      <button
                        key={chip.key}
                        type="button"
                        onClick={() => setBrandFilter(chip.key)}
                        className={`whitespace-nowrap h-10 px-4 rounded-full text-sm font-semibold border transition-colors ${FOCUS_RING} ${
                          active
                            ? 'bg-white text-black border-white shadow-md'
                            : 'bg-[#1a1d23] text-white/80 border-white/10 hover:bg-white/10 hover:text-white'
                        }`}
                        aria-pressed={active}
                      >
                        <span className="inline-flex items-center gap-2">
                          {chip.key !== 'all' && (
                            <BrandLogo
                              brand={chip.key as 'iphone' | 'samsung' | 'pixel'}
                              className={chip.key === 'samsung' ? 'h-4 w-auto' : 'w-4 h-4'}
                            />
                          )}
                          <span>{chip.label}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className={`h-10 px-3 rounded-xl bg-[#1a1d23] border border-white/10 text-white text-xs sm:text-sm focus:border-orange-500/60 ${FOCUS_RING}`}
                  aria-label={t.sortLabel}
                >
                  <option value="featured">{`${t.sortLabel} ${t.sortFeatured}`}</option>
                  <option value="price_asc">{t.sortPriceAsc}</option>
                  <option value="price_desc">{t.sortPriceDesc}</option>
                </select>
              </div>
            </div>
          )}

          {loading && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4" aria-busy="true" aria-live="polite">
              {Array.from({ length: 10 }).map((_, i) => (
                <ProductCardSkeleton key={i} />
              ))}
            </div>
          )}

          {!loading && (() => {
            const q = searchQuery.trim().toLowerCase();
            const activeBrand = BRAND_CHIPS.find(c => c.key === brandFilter) || BRAND_CHIPS[0];
            let filtered = q
              ? products.filter(p => cleanProductTitle(p.title).toLowerCase().includes(q))
              : products;
            filtered = filtered.filter(p => activeBrand.match(cleanProductTitle(p.title)));

            const trendingIds = new Set(products.slice(0, 5).map(p => p.id));

            const renderCard = (product: HotProduct, index: number, isDubai: boolean) => {
              const key = `${product.provider}-${product.provider_product_id}`;
              const isProcessing = processingIds.has(key);
              const isTrending = trendingIds.has(product.id);
              const cleanTitle = cleanProductTitle(product.title);
              const shareLink = `${SHARE_PREVIEW_BASE_URL}?id=${encodeURIComponent(product.id)}`;
              const payLink = `${window.location.origin}/hot-products/${product.id}`;
              const productImage = resolveProductImage(product);
              const productSummary = (product.description_fr || '').replace(/\s+/g, ' ').trim();
              const shortSummary = productSummary.length > 160 ? `${productSummary.slice(0, 157).trimEnd()}…` : productSummary;
              const productRef = `HP-${product.id.slice(0, 8).toUpperCase()}`;
              const waMsg = encodeURIComponent(t.waMessage({
                title: cleanTitle,
                summary: shortSummary,
                price: formatCurrency(product.total_price_usd, { locale: locale as any }),
                ref: productRef,
                image: productImage,
                link: payLink,
              }));
              const waHref = `https://wa.me/${whatsapp.replace(/[^0-9]/g, '')}?text=${waMsg}`;
              return (
                <motion.div
                  key={product.id}
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, delay: prefersReducedMotion ? 0 : Math.min(index * 0.015, 0.18) }}
                  className="relative flex flex-col bg-[#15181d] border border-white/[0.08] rounded-2xl overflow-hidden group hover:border-orange-500/40 transition-colors hover:shadow-[0_0_24px_rgba(249,115,22,0.15)] transform-gpu"
                >
                  <div className="absolute top-2.5 left-2.5 z-10 flex flex-col gap-1 items-start">
                    {isTrending && !isDubai && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-pink-500 to-purple-500 text-white text-[10px] font-bold uppercase tracking-wider shadow-md">
                        <TrendingUp className="w-3 h-3" aria-hidden="true" /> Top
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    className={`aspect-square bg-white overflow-hidden text-left ${FOCUS_RING}`}
                    onClick={() => {
                      trackClick(product, 'click');
                      navigate(`/share/hp/${product.id}`);
                    }}
                    aria-label={cleanTitle}
                  >
                    <img
                      src={resolveProductImage(product)}
                      alt={cleanTitle}
                      className="w-full h-full object-contain p-2.5 group-hover:scale-[1.03] transition-transform duration-300"
                      loading="lazy"
                      onError={(e) => {
                        const img = e.currentTarget;
                        if (img.src !== window.location.origin + '/placeholder.svg') {
                          img.src = '/placeholder.svg';
                        }
                      }}
                    />
                  </button>

                  <div className="flex flex-col flex-1 p-2.5 sm:p-3 gap-2">
                    <button
                      type="button"
                      className={`text-left text-white text-[12px] sm:text-[13px] font-medium leading-snug line-clamp-2 min-h-[2.25rem] hover:text-orange-300 transition-colors rounded ${FOCUS_RING}`}
                      onClick={() => {
                        trackClick(product, 'click');
                        navigate(`/share/hp/${product.id}`);
                      }}
                    >
                      {cleanTitle}
                    </button>

                    <div className="space-y-0.5">
                      <p className="text-orange-400 font-extrabold text-lg sm:text-xl leading-none tracking-tight">
                        {formatCurrency(product.total_price_usd, { locale: locale as any })}
                      </p>
                      <p className="text-emerald-400/90 text-[10px] font-medium">
                        ✓ {t.shippingIncluded}
                      </p>
                      {isDubai && (
                        <p className="text-white/50 text-[10px]">{t.estDelivery}</p>
                      )}
                      {(() => {
                        const v = viewCounts[`${product.provider}:${product.provider_product_id}`] || 0;
                        const display = v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${v}`;
                        return (
                          <p className="inline-flex items-center gap-1 text-white/60 text-[10px] font-medium pt-0.5">
                            <Eye className="w-3 h-3" aria-hidden="true" />
                            {locale === 'fr' ? `${display} vues` : `${display} views`}
                          </p>
                        );
                      })()}
                    </div>

                    <div className="mt-auto flex flex-col gap-1.5 pt-1">
                      <Button
                        size="sm"
                        className={`w-full h-10 text-sm font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm ${FOCUS_RING}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          trackClick(product, 'buy_now');
                          handleBuyNow(product);
                        }}
                        disabled={isProcessing}
                        aria-label={`${isDubai ? t.orderNow : t.payNow} — ${cleanTitle}`}
                      >
                        {isProcessing ? (
                          <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" aria-hidden="true" /> {t.loading}</>
                        ) : (
                          <><Zap className="w-4 h-4 mr-1.5" aria-hidden="true" /> {isDubai ? t.orderNow : t.payNow}</>
                        )}
                      </Button>

                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full h-9 text-xs font-semibold rounded-xl bg-green-600/10 hover:bg-green-600/20 text-green-300 border-green-500/40"
                        onClick={(e) => {
                          e.stopPropagation();
                          trackClick(product, 'click');
                          openChatbot({
                            id: product.id,
                            title: cleanTitle,
                            price_usd: product.total_price_usd,
                            image: productImage,
                            link: payLink,
                            category: isDubai ? 'dubai' : 'hot_product',
                          });
                        }}
                        aria-label={`${t.whatsapp} — ${cleanTitle}`}
                      >
                        <MessageCircle className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                        {t.whatsapp}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              );
            };

            const renderSection = (title: string, items: HotProduct[], opts?: { subtitle?: string; topBorder?: boolean }) => {
              if (items.length === 0) return null;
              const sorted = [...items];
              if (sortBy === 'price_asc') sorted.sort((a, b) => a.total_price_usd - b.total_price_usd);
              else if (sortBy === 'price_desc') sorted.sort((a, b) => b.total_price_usd - a.total_price_usd);
              return (
                <section className={opts?.topBorder ? 'mt-6 pt-5 border-t border-white/10' : 'mt-5 first:mt-0'}>
                  <div className="mb-3 flex items-baseline justify-between gap-3">
                    <div>
                      <h2 className="text-base sm:text-xl font-extrabold text-white tracking-tight">{title}</h2>
                      {opts?.subtitle && <p className="text-white/60 text-xs mt-0.5">{opts.subtitle}</p>}
                    </div>
                    <span className="text-white/40 text-xs whitespace-nowrap">{t.countItems(items.length)}</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                    {sorted.map((p, i) => renderCard(p, i, p.link_source === 'dubai'))}
                  </div>
                </section>
              );
            };

            if (filtered.length === 0 && products.length > 0) {
              return (
                <div className="text-center py-20">
                  <Search className="w-12 h-12 text-white/20 mx-auto mb-4" aria-hidden="true" />
                  <p className="text-white/50 mb-3">{t.noResults}</p>
                  <Button variant="outline" size="sm" onClick={() => setSearchQuery('')} className="bg-white/5 border-white/15 text-white hover:bg-white/10 hover:text-white">
                    {t.clearSearch}
                  </Button>
                </div>
              );
            }

            if (products.length === 0) {
              return (
                <div className="text-center py-20">
                  <Flame className="w-12 h-12 text-white/20 mx-auto mb-4" aria-hidden="true" />
                  <p className="text-white/50">{t.empty}</p>
                </div>
              );
            }

            if (q) {
              return renderSection(`"${searchQuery}"`, filtered);
            }

            const dubaiItems = filtered.filter(p => p.link_source === 'dubai');
            const regular = filtered.filter(p => p.link_source !== 'dubai');
            const trending = regular.filter(p => trendingIds.has(p.id));
            const allOthers = regular.filter(p => !trendingIds.has(p.id));

            return (
              <>
                {renderSection(t.sectionTrending, trending)}
                {renderSection('All Products', allOthers, { topBorder: trending.length > 0 })}
                {renderSection(t.dubaiSectionTitle, dubaiItems, { subtitle: t.dubaiSectionSubtitle, topBorder: regular.length > 0 })}
              </>
            );
          })()}
        </div>
      </main>

      {/* Global AfriShop chatbot widget provides the floating help button */}

      <ShopFooter />
      <BottomNavigation />

    </div>
    </>
  );
}
