import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Loader2, Ruler, ShoppingCart } from 'lucide-react';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { ShopFooter } from '@/components/shop/ShopFooter';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useShopCart } from '@/contexts/ShopCartContext';
import { toast } from 'sonner';
import { collectProductImageCandidates, pickBestImage } from '@/lib/imageValidation';
import { cleanIntlText, cleanIntlTitle } from '@/lib/intlProductText';
import { trackMetaViewContent, trackMetaAddToCart } from '@/lib/metaPixel';

interface CountryMeta {
  country: string;
  label_en: string;
  label_fr: string;
  flag_emoji: string;
  rate_per_kg_usd: number;
}

interface ShopifyVariant {
  id: string;
  gid: string;
  title: string;
  price_usd: number;
  available: boolean;
  selected_options: { name: string; value: string }[];
  image_url: string | null;
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
  options?: { name: string; values: string[] }[];
  variants?: ShopifyVariant[];
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

const TURKEY_MEN_TO_US: Record<string, string> = {
  '44': '34 / XS', '46': '36 / S', '48': '38 / M', '50': '40 / L', '52': '42 / XL', '54': '44 / 2XL', '56': '46 / 3XL', '58': '48 / 4XL', '60': '50 / 5XL',
};

const TURKEY_WOMEN_TO_US: Record<string, string> = {
  '34': '2 / XS', '36': '4 / S', '38': '6 / S', '40': '8 / M', '42': '10 / M', '44': '12 / L', '46': '14 / L', '48': '16 / XL', '50': '18 / XL', '52': '20 / 2XL', '54': '22 / 3XL', '56': '24 / 4XL', '58': '26 / 5XL',
};

function inferGenderFromText(title?: string | null, description?: string | null): 'men' | 'women' | 'unisex' {
  const text = `${title || ''} ${description || ''}`.toLowerCase();
  const men = ['men', 'mens', 'men\'s', 'homme', 'hommes', 'male', 'garçon', 'boys'];
  const women = ['women', 'womens', 'women\'s', 'femme', 'femmes', 'female', 'lady', 'ladies', 'filles', 'girls'];
  if (women.some((w) => text.includes(w))) return 'women';
  if (men.some((m) => text.includes(m))) return 'men';
  return 'unisex';
}

const ALLOWED = new Set(['china', 'turkey']);

function getTurkeyToUS(size: string, gender: 'men' | 'women' | 'unisex'): string | null {
  const clean = size.trim();
  if (gender === 'women') return TURKEY_WOMEN_TO_US[clean] || null;
  if (gender === 'men') return TURKEY_MEN_TO_US[clean] || null;
  const usMen = TURKEY_MEN_TO_US[clean];
  const usWomen = TURKEY_WOMEN_TO_US[clean];
  if (usMen && usWomen) return `${usMen} (men) / ${usWomen} (women)`;
  return usMen || usWomen || null;
}




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
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  // Shopify multi-option selection: { "Size": "M", "Color": "Navy [Bear]" }
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});

  const sizes = useMemo(() => {
    const raw = Array.isArray(product?.available_sizes) ? product!.available_sizes! : [];
    const all = raw.flatMap((s) =>
      String(s)
        .split(/[:,/|\s]+/)
        .map((x) => x.trim())
        .filter(Boolean),
    );
    return Array.from(new Set(all));
  }, [product]);
  const requiresSize = sizes.length > 0;

  // Shopify product options (Size, Color, ...) — China path only
  const shopifyOptions = useMemo(
    () => (Array.isArray(product?.options) ? product!.options! : []),
    [product],
  );
  const hasShopifyOptions = shopifyOptions.length > 0;

  const matchedVariant = useMemo(() => {
    if (!product?.variants?.length || !hasShopifyOptions) return null;
    return (
      product.variants.find((v) =>
        v.selected_options.every((o) => selectedOptions[o.name] === o.value),
      ) || null
    );
  }, [product, selectedOptions, hasShopifyOptions]);

  useEffect(() => {
    if (!ALLOWED.has(key)) {
      navigate('/', { replace: true });
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const productPromise: Promise<{ data: IntlProduct | null }> = key === 'china'
        ? supabase.functions.invoke('shopify-products', { body: {} })
            .then(async (r: any) => {
              const list: IntlProduct[] = r?.data?.products ?? [];
              const found = list.find((p) => String(p.id) === String(id)) || null;
              if (found) return { data: found };

              const { data } = await supabase
                .from('catalog_items')
                .select('id, title, image_url, images, product_url, price_usd, description, provider')
                .eq('id', id)
                .eq('provider', 'shein')
                .maybeSingle();

              return { data: data ? mapChinaCatalogItem(data) : null };
            })
            .catch(async () => {
              const { data } = await supabase
                .from('catalog_items')
                .select('id, title, image_url, images, product_url, price_usd, description, provider')
                .eq('id', id)
                .eq('provider', 'shein')
                .maybeSingle();

              return { data: data ? mapChinaCatalogItem(data) : null };
            })
        : ((supabase.from('international_products' as any).select('*').eq('id', id).maybeSingle()) as any);

      const [metaRes, settingsRes, prodRes] = await Promise.all([
        (supabase.from('country_shipping_rates' as any).select('*').eq('country', key).maybeSingle()) as any,
        supabase.from('settings' as any).select('markup_percent').limit(1).single() as any,
        productPromise,
      ]);
      if (cancelled) return;
      if (metaRes.data) setMeta(metaRes.data as CountryMeta);
      if (settingsRes.data?.markup_percent != null) {
        setGlobalMarkupPercent(Number(settingsRes.data.markup_percent));
      }
      if (prodRes.data) {
        const raw = prodRes.data as any;
        setProduct({
          ...raw,
          title: cleanIntlTitle(raw.title),
          description: cleanIntlText(raw.description) || null,
          measurements: raw.measurements ? cleanIntlText(raw.measurements) || null : null,
        } as IntlProduct);
      }
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

  // Meta Pixel: ViewContent on product detail load
  useEffect(() => {
    if (!product || !totals) return;
    trackMetaViewContent({ id: `intl_${product.id}`, title: product.title, price: totals.total });
  }, [product, totals]);

  const gallery = useMemo(() => {
    if (!product) return [];
    return (Array.isArray(product.images) && product.images.length > 0) ? product.images : [product.image_url];
  }, [product]);

  const handleAdd = async (buyNow: boolean) => {
    if (!product || !totals) return;
    if (requiresSize && !selectedSize) {
      toast.error(isFr ? 'Veuillez sélectionner une taille' : 'Please select a size');
      return;
    }
    if (hasShopifyOptions) {
      const missing = shopifyOptions.find((o) => !selectedOptions[o.name]);
      if (missing) {
        toast.error(isFr ? `Veuillez choisir : ${missing.name}` : `Please select: ${missing.name}`);
        return;
      }
      if (!matchedVariant) {
        toast.error(isFr ? 'Combinaison indisponible' : 'Selected combination unavailable');
        return;
      }
      if (!matchedVariant.available) {
        toast.error(isFr ? 'Variante en rupture de stock' : 'Variant out of stock');
        return;
      }
    }
    setAdding(true);
    try {
      const optionSuffix = hasShopifyOptions
        ? ' — ' + shopifyOptions.map((o) => `${o.name}: ${selectedOptions[o.name]}`).join(' / ')
        : selectedSize ? ` — ${isFr ? 'Taille' : 'Size'} ${selectedSize}` : '';
      const idSuffix = hasShopifyOptions && matchedVariant
        ? `_v${matchedVariant.id}`
        : selectedSize ? `_${selectedSize}` : '';
      await addItem({
        productId: `intl_${product.id}${idSuffix}`,
        provider: `intl_${product.country}`,
        title: `${product.title}${optionSuffix}`,
        imageUrl: matchedVariant?.image_url || product.image_url,
        priceUsd: totals.total,
        quantity: qty,
        productUrl: product.product_url,
        isVehicle: false,
        requiresManualQuote: false,
      });
      trackMetaAddToCart({ id: `intl_${product.id}`, title: product.title, price: totals.total });
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
                    <span className="text-muted-foreground">{isFr ? 'Frais de marge' : 'Markup Fee'}</span>
                    <span className="text-green-500">{isFr ? 'Inclus' : 'Included'}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{isFr ? 'Frais de livraison' : 'Shipping Fee'}</span>
                    <span className="text-green-500">{isFr ? 'Inclus' : 'Included'}</span>
                  </div>
                  <div className="border-t border-border/40 pt-2 flex justify-between items-center">
                    <span className="font-semibold">
                      {isFr ? 'Prix final' : 'Final Price'}
                      {qty > 1 && <span className="text-xs text-muted-foreground ml-2">${totals.total} × {qty}</span>}
                    </span>
                    <div className="text-2xl font-bold text-primary">${(totals.total * qty).toFixed(2)}</div>
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

              {hasShopifyOptions && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {shopifyOptions.map((opt) => {
                    const translatedName = isFr
                      ? (opt.name.toLowerCase() === 'size' ? 'Taille'
                        : opt.name.toLowerCase() === 'color' ? 'Couleur'
                        : opt.name.toLowerCase() === 'material' ? 'Matériau'
                        : opt.name.toLowerCase() === 'style' ? 'Style'
                        : opt.name)
                      : opt.name;
                    return (
                      <div key={opt.name} className="space-y-1.5">
                        <label className="text-sm font-medium flex items-center gap-1">
                          {translatedName}
                          <span className="text-destructive">*</span>
                        </label>
                        <Select
                          value={selectedOptions[opt.name] || ''}
                          onValueChange={(val) =>
                            setSelectedOptions((prev) => ({ ...prev, [opt.name]: val }))
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue
                              placeholder={isFr ? `Choisir ${translatedName.toLowerCase()}` : `Select ${opt.name.toLowerCase()}`}
                            />
                          </SelectTrigger>
                          <SelectContent className="max-h-72 bg-popover z-50">
                            {opt.values.map((val) => {
                              const otherSel = { ...selectedOptions, [opt.name]: val };
                              const hasAvail = (product?.variants || []).some((v) => {
                                if (!v.available) return false;
                                return v.selected_options.every((o) => {
                                  const sel = otherSel[o.name];
                                  return !sel || sel === o.value;
                                });
                              });
                              return (
                                <SelectItem key={val} value={val} disabled={!hasAvail}>
                                  {val}{!hasAvail ? (isFr ? ' — indisponible' : ' — unavailable') : ''}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              )}

              {requiresSize && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {isFr ? 'Sélectionnez votre taille' : 'Select your size'}
                      <span className="text-destructive ml-1">*</span>
                    </span>
                    {selectedSize && (
                      <span className="text-xs text-muted-foreground">
                        {isFr ? 'Sélectionné' : 'Selected'}: <strong className="text-foreground">{selectedSize}</strong>
                        {product && getTurkeyToUS(selectedSize, inferGenderFromText(product.title, product.description)) && (
                          <span className="ml-1 text-green-500">
                            = US {getTurkeyToUS(selectedSize, inferGenderFromText(product.title, product.description))}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {sizes.map((s) => {
                      const isActive = selectedSize === s;
                      const us = product ? getTurkeyToUS(s, inferGenderFromText(product.title, product.description)) : null;
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSelectedSize(s)}
                          className={`min-w-[3.5rem] px-3 py-2 rounded-lg border-2 text-sm font-medium transition-colors flex flex-col items-center leading-none ${
                            isActive
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-card hover:border-primary/60 text-foreground'
                          }`}
                        >
                          <span>{s}</span>
                          {us && (
                            <span className={`text-[10px] mt-0.5 ${isActive ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                              US {us}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <Collapsible className="pt-1">
                    <CollapsibleTrigger asChild>
                      <button type="button" className="text-xs text-primary flex items-center gap-1 hover:underline">
                        <Ruler className="h-3 w-3" />
                        {isFr ? 'Guide des tailles Turquie → US' : 'Turkey to US size guide'}
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="mt-2 rounded-xl border border-border/40 bg-card p-3 space-y-3">
                        <div className="text-xs text-muted-foreground">{isFr ? 'Équivalences indicatives' : 'Approximate equivalency'}</div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <div className="text-xs font-semibold text-foreground mb-1">{isFr ? 'Hommes' : 'Men'}</div>
                            <div className="grid grid-cols-2 gap-x-2 text-xs">
                              <span className="text-muted-foreground">TR</span>
                              <span className="text-muted-foreground">US</span>
                              {Object.entries(TURKEY_MEN_TO_US).map(([tr, us]) => (
                                <div key={tr} className="contents">
                                  <span className="text-foreground">{tr}</span>
                                  <span className="text-foreground">{us}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs font-semibold text-foreground mb-1">{isFr ? 'Femmes' : 'Women'}</div>
                            <div className="grid grid-cols-2 gap-x-2 text-xs">
                              <span className="text-muted-foreground">TR</span>
                              <span className="text-muted-foreground">US</span>
                              {Object.entries(TURKEY_WOMEN_TO_US).map(([tr, us]) => (
                                <div key={tr} className="contents">
                                  <span className="text-foreground">{tr}</span>
                                  <span className="text-foreground">{us}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
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
