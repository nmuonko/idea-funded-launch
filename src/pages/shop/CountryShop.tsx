import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Loader2, ShoppingCart, Zap } from 'lucide-react';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { ShopFooter } from '@/components/shop/ShopFooter';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useShopCart } from '@/contexts/ShopCartContext';
import { toast } from 'sonner';
import { collectProductImageCandidates, pickBestImage } from '@/lib/imageValidation';

interface CountryMeta {
  country: string;
  label_en: string;
  label_fr: string;
  flag_emoji: string;
  rate_per_kg_usd: number;
}

interface IntlProduct {
  id: string;
  country: string;
  title: string;
  image_url: string;
  images: string[] | null;
  product_url: string;
  base_price_usd: number;
  est_weight_kg: number;
  description: string | null;
  measurements?: string | null;
  created_at?: string;
  sort_order?: number | null;
  is_active?: boolean;
}


function mapChinaCatalogItem(row: any): IntlProduct | null {
  const candidates = collectProductImageCandidates(row.image_url, row.images, row.imageUrl, row.imageUrls);
  const imageUrl = pickBestImage(candidates, row.image_url, { policy: 'homepage' });
  if (!imageUrl || imageUrl === '/placeholder.svg') return null;
  return {
    id: String(row.id),
    country: 'china',
    title: row.title || 'Product',
    image_url: imageUrl,
    images: candidates,
    product_url: row.product_url || '',
    base_price_usd: Number(row.price_usd) || 0,
    est_weight_kg: 0.8,
    description: row.description || null,
    measurements: null,
  };
}

const ALLOWED = new Set(['china', 'turkey', 'usa']);

export default function CountryShop() {
  const { country = '' } = useParams<{ country: string }>();
  const key = country.toLowerCase();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const { addItem, exchangeRate } = useShopCart();
  const isFr = language === 'fr' || language === 'ln';

  const [meta, setMeta] = useState<CountryMeta | null>(null);
  const [globalMarkupPercent, setGlobalMarkupPercent] = useState<number>(15);
  const [products, setProducts] = useState<IntlProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);

  useEffect(() => {
    if (!ALLOWED.has(key)) {
      navigate('/', { replace: true });
      return;
    }
    if (key === 'usa') {
      // USA uses the main catalog; redirect home
      navigate('/', { replace: true });
      return;
    }
    // China is not live yet — show coming soon page. Turkey is LIVE (Telegram imports).
    if (key === 'china') {
      navigate(`/shop/${key}/coming-soon`, { replace: true });
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      const productsPromise = key === 'china'
        ? supabase.functions.invoke('shopify-products', { body: {} })
            .then(async (r: any) => {
              const liveProducts = Array.isArray(r?.data?.products) ? r.data.products : [];
              if (liveProducts.length > 0) return { data: liveProducts };

              const { data } = await supabase
                .from('catalog_items')
                .select('id, title, image_url, images, product_url, price_usd, description, provider')
                .in('provider', ['shopify_china', 'shein'])
                .eq('is_active', true)
                .eq('is_disallowed', false)
                .gt('price_usd', 0)
                .order('updated_at', { ascending: false })
                .limit(48);

              return { data: (data || []).map(mapChinaCatalogItem).filter(Boolean) };
            })
            .catch(async () => {
              const { data } = await supabase
                .from('catalog_items')
                .select('id, title, image_url, images, product_url, price_usd, description, provider')
                .in('provider', ['shopify_china', 'shein'])
                .eq('is_active', true)
                .eq('is_disallowed', false)
                .gt('price_usd', 0)
                .order('updated_at', { ascending: false })
                .limit(48);

              return { data: (data || []).map(mapChinaCatalogItem).filter(Boolean) };
            })
        : (supabase.from('international_products' as any)
            .select('*')
            .eq('country', key)
            .eq('is_active', true)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: false })) as any;

      const [metaRes, settingsRes, productsRes] = await Promise.all([
        (supabase.from('country_shipping_rates' as any).select('*').eq('country', key).maybeSingle()) as any,
        supabase.from('settings' as any).select('markup_percent').limit(1).single() as any,
        productsPromise,
      ]);
      if (cancelled) return;
      if (metaRes.data) setMeta(metaRes.data as CountryMeta);
      if (settingsRes.data) {
        const m = (settingsRes.data as any).markup_percent;
        if (m != null) setGlobalMarkupPercent(Number(m));
      }
      if (Array.isArray(productsRes.data)) setProducts(productsRes.data as IntlProduct[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [key, navigate]);

  // ===== Realtime: instantly reflect items published from the Telegram importer =====
  useEffect(() => {
    if (key === 'china' || key === 'usa' || !ALLOWED.has(key)) return;

    const upsert = (row: IntlProduct) => {
      setProducts((prev) => {
        const rest = prev.filter((p) => p.id !== row.id);
        if (row.is_active === false) return rest;
        const next = [row, ...rest];
        return next.sort((a, b) => {
          const sa = a.sort_order ?? 999999;
          const sb = b.sort_order ?? 999999;
          if (sa !== sb) return sa - sb;
          return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        });
      });
    };

    const channel = supabase
      .channel(`intl-products-${key}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'international_products', filter: `country=eq.${key}` },
        (payload) => {
          const row = (payload.new ?? payload.old) as IntlProduct | null;
          if (!row?.id) return;
          if (payload.eventType === 'DELETE') {
            setProducts((prev) => prev.filter((p) => p.id !== row.id));
            return;
          }
          upsert(row);
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [key]);

  const computedProducts = useMemo(() => {
    const ratePerKg = Number(meta?.rate_per_kg_usd ?? 0);
    const markupRate = globalMarkupPercent > 1 ? globalMarkupPercent / 100 : globalMarkupPercent;
    const now = Date.now();
    return products.map((p) => {
      const markup = p.base_price_usd * markupRate;
      const shipping = (Number(p.est_weight_kg) || 0) * ratePerKg;
      const total = Math.ceil(p.base_price_usd + markup + shipping);
      const isNew = p.created_at ? now - new Date(p.created_at).getTime() < 48 * 3600 * 1000 : false;
      return { ...p, totalUsd: total, isNew };
    });
  }, [products, meta, globalMarkupPercent]);


  const FALLBACK_LABELS: Record<string, { en: string; fr: string; flag: string }> = {
    turkey: { en: 'Turkey', fr: 'Turquie', flag: '🇹🇷' },
    china: { en: 'China', fr: 'Chine', flag: '🇨🇳' },
  };
  const fallback = FALLBACK_LABELS[key];
  const title = meta ? (isFr ? meta.label_fr : meta.label_en) : (fallback ? (isFr ? fallback.fr : fallback.en) : key);
  const flag = meta?.flag_emoji || fallback?.flag || '🌍';
  const newCount = computedProducts.filter((p) => p.isNew).length;


  const handleAdd = async (p: IntlProduct & { totalUsd: number }, buyNow: boolean) => {
    setAdding(p.id);
    try {
      await addItem({
        productId: `intl_${p.id}`,
        provider: `intl_${p.country}`,
        title: p.title,
        imageUrl: p.image_url,
        priceUsd: p.totalUsd, // all-inclusive (markup + shipping baked in, mirroring hot-products)
        quantity: 1,
        productUrl: p.product_url,
        isVehicle: false,
        requiresManualQuote: false,
      });
      toast.success(isFr ? 'Ajouté au panier' : 'Added to cart');
      if (buyNow) navigate('/cart');
    } catch (e) {
      toast.error(isFr ? 'Erreur lors de l\'ajout' : 'Failed to add to cart');
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1115] pb-safe-nav">
      <ShopHeader />
      <div className="pt-16 md:pt-20" />

      <div className="px-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <span className="text-2xl">{flag}</span>
            <span>{isFr ? `Produits de ${title}` : `Products from ${title}`}</span>
          </h1>
        </div>

        <div className="flex items-center gap-2 mb-4 pl-1 flex-wrap">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-green-400 bg-green-500/10 border border-green-500/20 rounded-full px-2.5 py-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
            </span>
            {isFr ? 'Mise à jour en direct' : 'Live updates'}
          </span>
          {!loading && (
            <span className="text-[11px] text-muted-foreground">
              {computedProducts.length} {isFr ? 'articles' : 'items'}
              {newCount > 0 && ` · ${newCount} ${isFr ? 'nouveaux' : 'new'}`}
            </span>
          )}
        </div>


        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : computedProducts.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <p className="text-base">
              {isFr ? `Aucun produit de ${title} pour le moment.` : `No products from ${title} yet.`}
            </p>
            <p className="text-sm mt-2">
              {isFr ? 'Revenez bientôt — de nouveaux articles arrivent.' : 'Check back soon — new items coming.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {computedProducts.map((p) => {
              const cdf = p.totalUsd * (exchangeRate || 0);
              const isAdding = adding === p.id;
              const gallery = (Array.isArray(p.images) && p.images.length > 0)
                ? p.images
                : [p.image_url];
              return (
                <div key={p.id} className="rounded-2xl border border-border/40 bg-card overflow-hidden flex flex-col">
                  <div
                    className="relative aspect-square bg-muted overflow-hidden cursor-pointer"
                    onClick={() => navigate(`/shop/${key}/product/${p.id}`)}
                  >
                    <div
                      className="flex h-full w-full overflow-x-auto snap-x snap-mandatory scrollbar-hide"
                      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                    >
                      {gallery.map((src, i) => (
                        <img
                          key={i}
                          src={src}
                          alt={`${p.title} ${i + 1}`}
                          loading="lazy"
                          className="w-full h-full object-cover flex-shrink-0 snap-center"
                          onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0.3'; }}
                        />
                      ))}
                    </div>
                    {p.isNew && (
                      <div className="absolute top-1.5 left-1.5 bg-green-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-full shadow">
                        {isFr ? 'NOUVEAU' : 'NEW'}
                      </div>
                    )}

                    {gallery.length > 1 && (
                      <div className="absolute bottom-1.5 right-1.5 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded-full">
                        {gallery.length} 📷
                      </div>
                    )}
                  </div>
                  <div className="p-3 flex flex-col gap-2 flex-1">
                    <p
                      className="text-sm font-medium text-foreground line-clamp-2 min-h-[2.5rem] cursor-pointer hover:text-primary"
                      onClick={() => navigate(`/shop/${key}/product/${p.id}`)}
                    >{p.title}</p>
                    <div className="mt-auto">
                      <div className="text-base font-bold text-primary">${p.totalUsd}</div>
                      {exchangeRate > 0 && (
                        <div className="text-xs text-muted-foreground">≈ {Math.round(cdf).toLocaleString()} CDF</div>
                      )}
                      <p className="text-[10px] text-green-500 mt-0.5">
                        {isFr ? 'Livraison incluse' : 'Shipping included'}
                      </p>
                    </div>
                    <div className="flex gap-2 mt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 px-2"
                        disabled={isAdding}
                        onClick={() => handleAdd(p, false)}
                      >
                        <ShoppingCart className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 px-2 bg-primary hover:bg-primary/90"
                        disabled={isAdding}
                        onClick={() => navigate(`/shop/${key}/product/${p.id}`)}
                      >
                        <Zap className="h-3.5 w-3.5 mr-1" />
                        {isFr ? 'Voir' : 'View'}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ShopFooter />
      <BottomNavigation />
    </div>
  );
}
