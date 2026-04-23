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

const ALLOWED = new Set(['china', 'dubai', 'turkey', 'usa']);

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

  const computedProducts = useMemo(() => {
    if (!meta) return [];
    const markupRate = globalMarkupPercent > 1 ? globalMarkupPercent / 100 : globalMarkupPercent;
    return products.map((p) => {
      const markup = p.base_price_usd * markupRate;
      const shipping = p.est_weight_kg * Number(meta.rate_per_kg_usd);
      const total = Math.ceil(p.base_price_usd + markup + shipping);
      return { ...p, totalUsd: total };
    });
  }, [products, meta, globalMarkupPercent]);

  const title = meta ? (isFr ? meta.label_fr : meta.label_en) : '';

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
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2">
            <span className="text-2xl">{meta?.flag_emoji}</span>
            <span>{isFr ? `Produits de ${title}` : `Products from ${title}`}</span>
          </h1>
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
