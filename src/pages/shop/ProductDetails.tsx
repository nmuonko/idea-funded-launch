import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, Link, useLocation, useNavigate } from 'react-router-dom';
import { trackRecentlyViewed } from '@/lib/recentlyViewed';
import { ArrowLeft, ShoppingCart, Check, Loader2, ExternalLink, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { ProductImageViewer } from '@/components/shop/ProductImageViewer';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { PriceBreakdown } from '@/components/shop/PriceBreakdown';
import { ProductGrid } from '@/components/shop/ProductGrid';
import { Product } from '@/components/shop/ProductCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useShopCart } from '@/contexts/ShopCartContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { cachedCatalogFetch } from '@/lib/catalogCache';
import { resizeImageUrl, IMAGE_SIZE_HERO, IMAGE_SIZE_THUMB } from '@/lib/imageResize';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

function looksLikeVehicleListing(title: string): boolean {
  const lower = title.toLowerCase();
  const exclusions = ['charger', 'mount', 'holder', 'brake pad', 'oil filter',
    'toy car', 'diecast', 'model car', 'rc car', 'hot wheels', 'key fob',
    'floor mat', 'seat cover', 'car wash', 'phone holder', 'emblem', 'badge',
    'washer bottle', 'wiper', 'antenna', 'mirror cover', 'mud flap',
    'stereo', 'radio', 'navigation', 'carplay', 'android auto', 'headunit',
    'head unit', 'media player', 'dashcam', 'dash cam', 'speaker', 'amplifier',
    'subwoofer', 'gps', 'bluetooth', 'adapter', 'cable', 'obd', 'scanner',
    'led light', 'light bar', 'fog light', 'backup camera', 'reverse camera',
    'tablet', 'touchscreen', 'display', 'screen protector', 'car cover',
    'air freshener', 'cup holder', 'trunk organizer', 'sun visor'];
  if (exclusions.some(e => lower.includes(e))) return false;

  const brands = ['toyota', 'honda', 'ford', 'chevrolet', 'chevy', 'nissan',
    'bmw', 'mercedes', 'audi', 'tesla', 'jeep', 'hyundai', 'kia', 'subaru',
    'mazda', 'volkswagen', 'lexus', 'porsche', 'dodge', 'ram', 'gmc',
    'land rover', 'range rover', 'volvo', 'buick', 'cadillac', 'lincoln'];

  const forBrandPattern = new RegExp(
    '\\bfor\\s+(' + brands.join('|') + ')\\b', 'i'
  );
  if (forBrandPattern.test(title)) return false;

  const bodyTypes = ['sedan', 'suv', 'truck', 'coupe', 'hatchback', 'convertible',
    'minivan', 'wagon', 'pickup', 'crossover', '4x4', 'motorcycle'];
  const hasYear = /\b(19|20)\d{2}\b/.test(title);
  const hasBrand = brands.some(b => lower.includes(b));
  const hasBodyType = bodyTypes.some(b => lower.includes(b));
  return (hasYear && hasBrand) || (hasBrand && hasBodyType);
}

interface ProductData {
  id: string;
  provider: string;
  title: string;
  description?: string;
  images: string[];
  priceUsd: number;
  rating?: number;
  reviewCount?: number;
  inStock: boolean;
  productUrl?: string;
  brand?: string;
  variants?: Array<{
    asin?: string;
    title?: string;
    dimensions?: Array<{ name: string; value: string }>;
    image?: string;
    link?: string;
    price?: { value: number; currency: string };
    isCurrent?: boolean;
  }>;
}

interface VariantGroup {
  name: string;
  options: Array<{
    value: string;
    asin?: string;
    image?: string;
    isCurrent?: boolean;
  }>;
}

export default function ProductDetailsPage() {
  const { provider, id } = useParams<{ provider: string; id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { addItem, items } = useShopCart();
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = (t.shop || {}) as any;

  const { user } = useAuth();

  const [product, setProduct] = useState<ProductData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [quoteRequested, setQuoteRequested] = useState(false);
  const [similarProducts, setSimilarProducts] = useState<Product[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const navProductRef = useRef<ProductData | null>(null);

  const isVehicleFromState = !!(
    (location.state as any)?.product?.isVehicle ||
    (location.state as any)?.isVehicle ||
    (location.state as any)?.categoryKey?.includes('vehicle') ||
    (location.state as any)?.subtabKey?.includes('vehicle')
  );
  const isVehicle = isVehicleFromState || (product ? looksLikeVehicleListing(product.title) : false);

  // Safe accessors
  const safeImages = useMemo(() => {
    if (product?.images?.length) return product.images;
    return ['/placeholder.svg'];
  }, [product?.images]);

  const safeImageIndex = Math.min(currentImageIndex, safeImages.length - 1);

  // Preload first 4 gallery images when data arrives
  // Preload only the first image at hero size (not 4 full-res images)
  useEffect(() => {
    if (!safeImages.length || safeImages[0] === '/placeholder.svg') return;
    const img = new Image();
    img.src = resizeImageUrl(safeImages[0], IMAGE_SIZE_HERO);
  }, [safeImages]);

  // Group variants by dimension name
  const variantGroups = useMemo((): VariantGroup[] => {
    if (!product?.variants?.length) return [];
    const groups = new Map<string, Map<string, { asin?: string; image?: string; isCurrent?: boolean }>>();

    for (const v of product.variants) {
      if (!v.dimensions?.length) continue;
      for (const dim of v.dimensions) {
        if (!dim.name || !dim.value) continue;
        if (!groups.has(dim.name)) groups.set(dim.name, new Map());
        const optMap = groups.get(dim.name)!;
        if (!optMap.has(dim.value)) {
          optMap.set(dim.value, { asin: v.asin, image: v.image, isCurrent: v.isCurrent });
        }
      }
    }

    return Array.from(groups.entries()).map(([name, optMap]) => ({
      name,
      options: Array.from(optMap.entries()).map(([value, data]) => ({ value, ...data })),
    }));
  }, [product?.variants]);

  // Reset state when route params change
  useEffect(() => {
    const nav = (location.state as any)?.product;
    const normalizedProvider = nav?.provider?.toLowerCase() === 'rainforest' ? 'amazon' : nav?.provider;
    const navProduct: ProductData | null = nav ? {
      id: nav.id,
      provider: normalizedProvider || 'amazon',
      title: nav.title || 'Product',
      description: undefined,
      images: nav.imageUrl ? [nav.imageUrl] : ['/placeholder.svg'],
      priceUsd: nav.priceUsd || 0,
      rating: nav.rating,
      reviewCount: undefined,
      inStock: true,
      productUrl: nav.productUrl,
      brand: undefined,
      variants: nav.variants,
    } : null;
    setProduct(navProduct);
    navProductRef.current = navProduct;
    setCurrentImageIndex(0);
    setSimilarProducts([]);
    setQuantity(1);
    setAdded(false);
    setQuoteRequested(false);
    setLoading(!nav);
    setError(null);
    setLightboxOpen(false);
  }, [provider, id]);

  // Fetch product by route param — always, regardless of nav state
  useEffect(() => {
    if (!provider || !id) return;

    const controller = new AbortController();
    const fetchStart = Date.now();
    const hadInitialData = !!navProductRef.current;

    const fetchProduct = async () => {
      try {
        setError(null);
        const productIdDecoded = decodeURIComponent(id);
        const lowerProvider = provider.toLowerCase();
        const lowerProductId = productIdDecoded.toLowerCase();

        let cleanProductId = productIdDecoded;
        if (lowerProvider === 'ebay' && lowerProductId.startsWith('ebay_')) {
          cleanProductId = productIdDecoded.slice(5);
        } else if (lowerProvider === 'ebay' && lowerProductId.startsWith('ebay:')) {
          cleanProductId = productIdDecoded.slice(5);
        } else if ((lowerProvider === 'rainforest' || lowerProvider === 'amazon') && lowerProductId.startsWith('amazon_')) {
          cleanProductId = productIdDecoded.slice(7);
        } else if (lowerProvider === 'rainforest' && lowerProductId.startsWith('rainforest_')) {
          cleanProductId = productIdDecoded.slice(11);
        }

        const normalizedProvider = lowerProvider === 'rainforest' ? 'amazon' : lowerProvider;

        const apiUrl = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/catalog-product`);
        apiUrl.searchParams.set('provider', normalizedProvider);
        apiUrl.searchParams.set('id', cleanProductId);
        if (normalizedProvider === 'amazon') {
          apiUrl.searchParams.set('amazon_domain', 'amazon.com');
        }

        const response = await fetch(apiUrl.toString(), {
          signal: controller.signal,
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
          },
        });

        if (controller.signal.aborted) return;

        let data: any;
        try {
          data = await response.json();
        } catch {
          throw new Error('Invalid response from server');
        }

        if (controller.signal.aborted) return;

        if (!response.ok || data.status === 'error') {
          throw new Error(data.error?.message || 'Product not found');
        }

        if (!data?.item) throw new Error('Product not found');

        const item = data.item;

        setProduct(prev => {
          const newImages = item.images || item.imageUrls || (item.image_url ? [item.image_url] : []);
          let mergedImages = newImages;
          const fetchedId = item.provider_product_id || item.id;
          if (prev?.id && prev.id === fetchedId) {
            const existingSet = new Set(prev.images);
            const additional = newImages.filter((img: string) => !existingSet.has(img));
            mergedImages = [...prev.images, ...additional];
          }
          if (mergedImages.length === 0) mergedImages = ['/placeholder.svg'];

          return {
            id: item.provider_product_id || item.id || prev?.id || '',
            provider: item.provider || provider || prev?.provider || '',
            title: item.title || prev?.title || 'Product',
            description: item.description || prev?.description,
            images: mergedImages,
            priceUsd: item.price_usd || item.priceUsd || prev?.priceUsd || 0,
            rating: item.rating ?? prev?.rating,
            reviewCount: item.review_count || item.reviewCount || prev?.reviewCount,
            inStock: item.in_stock !== false,
            productUrl: item.product_url || item.productUrl || prev?.productUrl,
            brand: item.brand || prev?.brand,
            variants: item.variants || undefined,
          };
        });

        console.log('[ProductDetails] fetch complete', {
          id: cleanProductId,
          provider: normalizedProvider,
          durationMs: Date.now() - fetchStart,
          hadInitialData,
          source: data.source,
          hasVariants: !!item.variants?.length,
        });
      } catch (err: any) {
        if (controller.signal.aborted) return;
        console.error('[ProductDetails] fetch error', {
          id, provider, error: err.message,
          durationMs: Date.now() - fetchStart,
          hadInitialData,
        });
        if (!navProductRef.current) {
          setError(err.message || 'Failed to load product');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    fetchProduct();
    return () => controller.abort();
  }, [provider, id]);

  // Track recently viewed
  useEffect(() => {
    if (!product || !product.id || !product.title) return;
    trackRecentlyViewed(
      {
        id: product.id,
        provider: product.provider,
        title: product.title,
        imageUrl: product.images?.[0] || '',
        priceUsd: product.priceUsd,
        productUrl: product.productUrl,
      },
      user?.id
    );
  }, [product?.id, product?.provider]);

  // Fetch similar products
  useEffect(() => {
    const title = product?.title;
    if (!title || !provider || !id) return;
    const controller = new AbortController();

    const fetchSimilar = async () => {
      try {
        const keywords = title.split(' ').slice(0, 3).join(' ');
        const similarData = await cachedCatalogFetch<any>('catalog-search', {
          q: keywords.trim().toLowerCase(),
          limit: 5,
        });

        if (controller.signal.aborted) return;
        if (similarData?.items) {
          const currentId = product?.id || id;
          setSimilarProducts(
            similarData.items
              .filter((i: any) => (i.provider_product_id || i.id) !== currentId)
              .slice(0, 4)
              .map((i: any) => ({
                id: i.provider_product_id || i.id,
                provider: i.provider || 'amazon',
                title: i.title || 'Product',
                imageUrl: i.imageUrl || i.image_url || i.mainImageUrl || '',
                priceUsd: i.priceUsd || i.price_usd || 0,
                rating: i.rating,
                productUrl: i.productUrl || i.product_url,
              }))
          );
        }
      } catch (err) {
        if (!controller.signal.aborted) console.warn('Failed to fetch similar products:', err);
      }
    };

    fetchSimilar();
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, id]);

  // Check if this vehicle product is already in the user's cart
  const isInCart = product && items.some(item => {
    if (item.productUrl && product.productUrl && item.productUrl === product.productUrl) return true;
    if (item.productId === product.id) return true;
    if (product.id && item.productId?.includes(product.id)) return true;
    return false;
  });
  // Quote requests are now initiated from the cart page, not here
  const showRequestQuote = false;

  const handleAddToCart = useCallback(async () => {
    if (!product) return;
    setAdding(true);
    try {
      await addItem({
        productId: product.id,
        provider: product.provider,
        title: product.title,
        imageUrl: safeImages[0] || '',
        priceUsd: product.priceUsd,
        quantity,
        productUrl: product.productUrl,
      });
      setAdded(true);
      setTimeout(() => setAdded(false), 3000);
    } finally {
      setAdding(false);
    }
  }, [product, quantity, safeImages, addItem]);

  const handleRequestQuote = useCallback(async () => {
    setAdding(true);
    try {
      const { error } = await supabase.functions.invoke('mobile-request-quote', {
        body: { locale: language }
      });
      if (error) throw error;
      setQuoteRequested(true);
      toast.success(shop.requestSent || 'Quote request sent!');
    } catch (err) {
      console.error('[ProductDetails] Quote request failed:', err);
      toast.error('Failed to request quote');
    } finally {
      setAdding(false);
    }
  }, [language, shop]);

  const handleVariantSelect = useCallback((asin: string | undefined) => {
    if (!asin || asin === product?.id) return;

    // Find the clicked variant
    const clickedVariant = product?.variants?.find(v => v.asin === asin);
    if (!clickedVariant) return;

    // 1. Optimistic UI update - instant
    setProduct(prev => {
      if (!prev) return prev;
      const newImage = clickedVariant.image;
      const updatedVariants = prev.variants?.map(v => ({
        ...v,
        isCurrent: v.asin === asin,
      }));
      return {
        ...prev,
        id: asin,
        images: newImage ? [newImage] : prev.images,
        variants: updatedVariants,
      };
    });
    setCurrentImageIndex(0);

    // 2. Update URL without triggering navigation
    const displayProv = product?.provider?.toLowerCase() === 'rainforest'
      ? 'amazon' : (product?.provider || 'amazon');
    window.history.replaceState(null, '', `/product/${displayProv}/${asin}`);

    // 3. Background fetch for full product data
    const fetchVariantData = async () => {
      try {
        const apiUrl = new URL(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/catalog-product`
        );
        apiUrl.searchParams.set('provider', 'amazon');
        apiUrl.searchParams.set('id', asin);
        apiUrl.searchParams.set('amazon_domain', 'amazon.com');

        const resp = await fetch(apiUrl.toString(), {
          headers: {
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
          },
        });
        const data = await resp.json();
        if (!data?.item) return;
        const item = data.item;

        setProduct(prev => {
          if (!prev || prev.id !== asin) return prev; // stale guard
          const newImages = item.images || item.imageUrls ||
            (item.image_url ? [item.image_url] : []);
          return {
            ...prev,
            title: item.title || prev.title,
            description: item.description || prev.description,
            images: newImages.length > 0 ? newImages : prev.images,
            priceUsd: item.price_usd || item.priceUsd || prev.priceUsd,
            rating: item.rating ?? prev.rating,
            reviewCount: item.review_count || prev.reviewCount,
            brand: item.brand || prev.brand,
            variants: item.variants || prev.variants,
          };
        });
      } catch (err) {
        console.warn('[ProductDetails] background variant fetch failed', err);
      }
    };

    fetchVariantData();
  }, [product]);

  const translateVariantLabel = useCallback((name: string) => {
    const key = name.toLowerCase();
    const map: Record<string, string> = {
      color: shop.variantColor || 'Color',
      colour: shop.variantColor || 'Color',
      size: shop.variantSize || 'Size',
      style: shop.variantStyle || 'Style',
      storage: shop.variantStorage || 'Storage',
      pattern: shop.variantPattern || 'Pattern',
      material: shop.variantMaterial || 'Material',
    };
    return map[key] || name;
  }, [shop]);

  const nextImage = () => setCurrentImageIndex(prev => (prev + 1) % safeImages.length);
  const prevImage = () => setCurrentImageIndex(prev => (prev - 1 + safeImages.length) % safeImages.length);

  if (loading) {
    return (
      <div className="min-h-screen bg-black">
        <ShopHeader />
        <div className="pt-24 px-4">
          <div className="container mx-auto max-w-6xl">
            <div className="grid lg:grid-cols-2 gap-8">
              <Skeleton className="aspect-square rounded-2xl bg-white/10" />
              <div className="space-y-4">
                <Skeleton className="h-8 w-3/4 bg-white/10" />
                <Skeleton className="h-6 w-1/4 bg-white/10" />
                <Skeleton className="h-32 w-full bg-white/10" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="min-h-screen bg-black">
        <ShopHeader />
        <div className="pt-24 px-4 text-center">
          <p className="text-red-400 mb-4">{error || 'Product not found'}</p>
          <Link to="/">
            <Button variant="outline" className="border-white/20 text-white hover:bg-white/10">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Shop
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const displayProvider = product.provider?.toLowerCase() === 'rainforest' ? 'amazon' : product.provider;
  const providerColor = displayProvider === 'amazon'
    ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    : 'bg-blue-500/20 text-blue-400 border-blue-500/30';

  const displayPrice = product.priceUsd;
  const safeRating = typeof product.rating === 'number' ? product.rating : null;

  return (
    <div className="min-h-screen bg-black">
      <ShopHeader />

      <main className="pt-24 px-4 pb-20">
        <div className="container mx-auto max-w-6xl">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-6 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Shop
          </Link>

          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
            {/* Image Gallery */}
            <div className="space-y-4">
              <div
                className="relative aspect-square bg-white/5 rounded-2xl overflow-hidden border border-white/10 cursor-pointer"
                onClick={() => setLightboxOpen(true)}
              >
                <AnimatePresence mode="wait">
                  <motion.img
                    key={safeImages[safeImageIndex]}
                    src={resizeImageUrl(safeImages[safeImageIndex] || '/placeholder.svg', IMAGE_SIZE_HERO)}
                    alt={product.title}
                    loading="eager"
                    fetchPriority="high"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full object-contain p-8"
                  />
                </AnimatePresence>

                {safeImages.length > 1 && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); prevImage(); }}
                      className="absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/50 text-white hover:bg-black/70"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); nextImage(); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/50 text-white hover:bg-black/70"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </Button>
                  </>
                )}

                <Badge variant="outline" className={`absolute top-4 left-4 capitalize ${providerColor}`}>
                  {displayProvider === 'amazon' ? 'Amazon' : displayProvider === 'ebay' ? 'eBay' : displayProvider}
                </Badge>
              </div>

              {safeImages.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {safeImages.slice(0, 6).map((img, index) => (
                    <button
                      key={index}
                      onClick={() => setCurrentImageIndex(index)}
                      className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                        index === safeImageIndex
                          ? 'border-blue-500'
                          : 'border-white/10 hover:border-white/30'
                      }`}
                    >
                      <img
                        src={resizeImageUrl(img, IMAGE_SIZE_THUMB)}
                        alt={`${product.title} ${index + 1}`}
                        loading="lazy"
                        className="w-full h-full object-contain bg-white/5 p-1"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Product Info */}
            <div className="space-y-6">
              {product.brand && (
                <p className="text-sm text-white/60 uppercase tracking-wider">
                  {product.brand}
                </p>
              )}

              <h1 className="text-2xl md:text-3xl font-bold text-white">
                {product.title}
              </h1>

              {/* Rating */}
              {safeRating !== null && safeRating > 0 && (
                <div className="flex items-center gap-2">
                  <div className="flex items-center">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <span
                        key={i}
                        className={i < Math.round(safeRating) ? 'text-yellow-400' : 'text-white/20'}
                      >
                        ★
                      </span>
                    ))}
                  </div>
                  <span className="text-white/60">
                    {safeRating.toFixed(1)}
                    {product.reviewCount ? ` (${product.reviewCount} reviews)` : ''}
                  </span>
                </div>
              )}

              {/* Stock Status */}
              {product.inStock ? (
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                  {shop.inStock || 'In Stock'}
                </Badge>
              ) : (
                <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                  {shop.outOfStock || 'Out of Stock'}
                </Badge>
              )}

              {/* Variant Selectors */}
              {variantGroups.length > 0 && (
                <div className="space-y-4">
                  {variantGroups.map(group => (
                    <div key={group.name}>
                      <h4 className="text-sm font-medium text-white/70 mb-2">{translateVariantLabel(group.name)}</h4>
                      <div className="flex flex-wrap gap-2">
                        {group.options.slice(0, 16).map((opt, idx) => {
                          const isSelected = opt.isCurrent === true;
                          return (
                            <button
                              key={idx}
                              onClick={() => handleVariantSelect(opt.asin)}
                              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                                isSelected
                                  ? 'border-blue-500 bg-blue-500/20 text-blue-400'
                                  : 'border-white/20 text-white/70 hover:border-white/40'
                              }`}
                            >
                              {opt.image && (
                                <img
                                  src={opt.image}
                                  alt={opt.value}
                                  className="w-5 h-5 rounded-sm object-cover"
                                />
                              )}
                              {opt.value}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Price Breakdown */}
              <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
                <PriceBreakdown
                  itemPriceUsd={displayPrice}
                  quantity={quantity}
                  isVehicle={isVehicle}
                  context="product-detail"
                />
              </div>

              {/* Quantity Selector */}
              <div className="flex items-center gap-4">
                <span className="text-white/70">{shop.quantity || 'Quantity'}:</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="h-8 w-8 p-0 border-white/20 text-white hover:bg-white/10"
                  >
                    -
                  </Button>
                  <span className="text-white w-8 text-center">{quantity}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setQuantity(quantity + 1)}
                    className="h-8 w-8 p-0 border-white/20 text-white hover:bg-white/10"
                  >
                    +
                  </Button>
                </div>
              </div>

              {/* Add to Cart */}
              <Button
                onClick={handleAddToCart}
                disabled={adding || !product.inStock}
                className={`w-full h-14 text-lg rounded-full transition-all ${
                  added
                    ? 'bg-green-500 hover:bg-green-600'
                    : 'bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600'
                }`}
              >
                {adding ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : added ? (
                  <>
                    <Check className="h-5 w-5 mr-2" />
                    {shop.addedToCart || 'Added to Cart'}
                  </>
                ) : (
                  <>
                    <ShoppingCart className="h-5 w-5 mr-2" />
                    {shop.addToCart || 'Add to Cart'}
                  </>
                )}
              </Button>

              {/* View Original */}
              {product.productUrl && (
                <a
                  href={product.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 text-sm text-white/60 hover:text-white transition-colors"
                >
                  <ExternalLink className="h-4 w-4" />
                  View on {displayProvider === 'amazon' ? 'Amazon' : displayProvider === 'ebay' ? 'eBay' : displayProvider}
                </a>
              )}

              {/* Description */}
              {product.description && (
                <div className="pt-6 border-t border-white/10">
                  <h3 className="text-lg font-semibold text-white mb-3">Description</h3>
                  <p className="text-white/70 whitespace-pre-line">{product.description}</p>
                </div>
              )}
            </div>
          </div>

          {/* Similar Products */}
          {similarProducts.length > 0 && (
            <section className="mt-16">
              <h2 className="text-xl font-bold text-white mb-6">Similar Products</h2>
              <ProductGrid products={similarProducts} />
            </section>
          )}
        </div>
      </main>

      {lightboxOpen && (
        <ProductImageViewer
          images={safeImages}
          currentIndex={safeImageIndex}
          onClose={() => setLightboxOpen(false)}
          onIndexChange={setCurrentImageIndex}
        />
      )}

      <BottomNavigation />
    </div>
  );
}
