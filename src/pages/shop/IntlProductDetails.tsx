import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, ShoppingCart } from 'lucide-react';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { ShopFooter } from '@/components/shop/ShopFooter';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useShopCart } from '@/contexts/ShopCartContext';
import { toast } from 'sonner';

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
  available_sizes?: string[] | null;
  is_active?: boolean;
}

const ALLOWED = new Set(['china', 'dubai', 'turkey']);

export default function IntlProductDetails() {
  const { country = '', id = '' } = useParams<{ country: string; id: string }>();
  const key = country.toLowerCase();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const { addItem, exchangeRate } = useShopCart();
  const isFr = language === 'fr' || language === 'ln';

  const [meta, setMeta] = useState<CountryMeta | null>(null);
  const [globalMarkupPercent, setGlobalMarkupPercent] = useState<number>(15);
  const [product, setProduct] = useState<IntlProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [qty, setQty] = useState(1);
  const [activeImg, setActiveImg] = useState(0);

  useEffect(() => {
    if (!ALLOWED.has(key)) {
      navigate('/', { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [metaRes, settingsRes, prodRes] = await Promise.all([
        (supabase.from('country_shipping_rates' as any).select('*').eq('country', key).maybeSingle()) as any,
        supabase.from('settings' as any).select('markup_percent').limit(1).single() as any,
        (supabase.from('international_products' as any).select('*').eq('id', id).maybeSingle()) as any,
      ]);
      if (cancelled) return;
      if (metaRes.data) setMeta(metaRes.data as CountryMeta);
      if (settingsRes.data?.markup_percent != null) {
        setGlobalMarkupPercent(Number(settingsRes.data.markup_percent));
      }
      if (prodRes.data) setProduct(prodRes.data as IntlProduct);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [key, id, navigate]);

  const totals = useMemo(() => {
    if (!product || !meta) return null;
    const markupRate = globalMarkupPercent > 1 ? globalMarkupPercent / 100 : globalMarkupPercent;
    const markup = product.base_price_usd * markupRate;
    const shipping = product.est_weight_kg * Number(meta.rate_per_kg_usd);
    const total = Math.ceil(product.base_price_usd + markup + shipping);
    return { markup, shipping, total };
  }, [product, meta, globalMarkupPercent]);

  const gallery = useMemo(() => {
    if (!product) return [];
    return (Array.isArray(product.images) && product.images.length > 0) ? product.images : [product.image_url];
  }, [product]);

  const handleAdd = async (buyNow: boolean) => {
    if (!product || !totals) return;
    setAdding(true);
    try {
      await addItem({
        productId: `intl_${product.id}`,
        provider: `intl_${product.country}`,
        title: product.title,
        imageUrl: product.image_url,
        priceUsd: totals.total,
        quantity: qty,
        productUrl: product.product_url,
        isVehicle: false,
        requiresManualQuote: false,
      });
      toast.success(isFr ? 'Ajouté au panier' : 'Added to cart');
      if (buyNow) navigate('/cart');
    } catch {
      toast.error(isFr ? 'Erreur lors de l\'ajout' : 'Failed to add');
    } finally {
      setAdding(false);
    }
  };

  const countryLabel = meta ? (isFr ? meta.label_fr : meta.label_en) : '';
  const cdf = totals && exchangeRate > 0 ? Math.round(totals.total * exchangeRate) : 0;

  return (
    <div className="min-h-screen bg-[#0f1115] pb-safe-nav">
      <ShopHeader />
      <div className="pt-16 md:pt-20" />

      <div className="px-4 max-w-6xl mx-auto">
        <button
          onClick={() => navigate(`/shop/${key}`)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          {isFr ? 'Retour' : 'Back to Shop'}
        </button>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : !product ? (
          <div className="text-center py-20 text-muted-foreground">
            {isFr ? 'Produit introuvable' : 'Product not found'}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6 lg:gap-8">
            {/* Gallery */}
            <div>
              <div className="relative aspect-square bg-card rounded-2xl overflow-hidden border border-border/40">
                <span className="absolute top-3 left-3 z-10 bg-orange-500 text-white text-xs font-semibold px-2.5 py-1 rounded">
                  {meta?.flag_emoji} {countryLabel}
                </span>
                <img
                  src={gallery[activeImg]}
                  alt={product.title}
                  className="w-full h-full object-contain"
                />
                {gallery.length > 1 && (
                  <>
                    <button
                      onClick={() => setActiveImg((activeImg - 1 + gallery.length) % gallery.length)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background rounded-full p-2"
                      aria-label="Previous"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => setActiveImg((activeImg + 1) % gallery.length)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/80 hover:bg-background rounded-full p-2"
                      aria-label="Next"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </>
                )}
              </div>
              {gallery.length > 1 && (
                <div className="flex gap-2 mt-3 overflow-x-auto scrollbar-hide">
                  {gallery.map((src, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveImg(i)}
                      className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 ${
                        i === activeImg ? 'border-primary' : 'border-border/40'
                      }`}
                    >
                      <img src={src} alt={`thumb ${i + 1}`} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Details */}
            <div className="flex flex-col gap-4">
              <h1 className="text-2xl md:text-3xl font-bold text-foreground leading-tight">
                {product.title}
              </h1>

              <div className="inline-flex w-fit bg-green-500/15 text-green-500 px-3 py-1 rounded-md text-sm font-medium">
                {isFr ? 'En stock' : 'In Stock'}
              </div>

              {totals && (
                <div className="rounded-2xl border border-border/40 bg-card p-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{isFr ? 'Article' : 'Item'}</span>
                    <span className="text-foreground">${product.base_price_usd.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{isFr ? 'Frais de marge' : 'Markup Fee'}</span>
                    <span className="text-green-500">{isFr ? 'Inclus' : 'Included'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{isFr ? 'Frais de livraison' : 'Shipping Fee'}</span>
                    <span className="text-green-500">{isFr ? 'Inclus' : 'Included'}</span>
                  </div>
                  <div className="border-t border-border/40 pt-2 flex justify-between items-center">
                    <span className="font-semibold">Total</span>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-primary">${totals.total}</div>
                      {cdf > 0 && (
                        <div className="text-xs text-muted-foreground">≈ {cdf.toLocaleString()} CDF</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {product.measurements && (
                <div className="rounded-xl border border-border/40 bg-card p-3">
                  <div className="text-xs text-muted-foreground mb-1">{isFr ? 'Mesures' : 'Measurements'}</div>
                  <div className="text-sm text-foreground whitespace-pre-line">{product.measurements}</div>
                </div>
              )}

              {product.description && (
                <div className="text-sm text-muted-foreground whitespace-pre-line">
                  {product.description}
                </div>
              )}

              <div className="flex items-center gap-3">
                <span className="text-sm font-medium">{isFr ? 'Quantité' : 'Quantity'}:</span>
                <button
                  onClick={() => setQty(Math.max(1, qty - 1))}
                  className="w-9 h-9 rounded-md border border-border/40 hover:bg-muted"
                >−</button>
                <span className="min-w-[2rem] text-center font-medium">{qty}</span>
                <button
                  onClick={() => setQty(qty + 1)}
                  className="w-9 h-9 rounded-md border border-border/40 hover:bg-muted"
                >+</button>
              </div>

              <Button
                size="lg"
                disabled={adding}
                onClick={() => handleAdd(false)}
                className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white"
              >
                <ShoppingCart className="h-4 w-4 mr-2" />
                {isFr ? 'Ajouter au panier' : 'Add to Cart'}
              </Button>
              <Button
                size="lg"
                variant="outline"
                disabled={adding}
                onClick={() => handleAdd(true)}
                className="w-full"
              >
                {isFr ? 'Acheter maintenant' : 'Buy Now'}
              </Button>
            </div>
          </div>
        )}
      </div>

      <ShopFooter />
      <BottomNavigation />
    </div>
  );
}
