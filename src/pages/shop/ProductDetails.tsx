import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { trackRecentlyViewed } from '@/lib/recentlyViewed';
import { ArrowLeft, ShoppingCart, Check, Loader2, ExternalLink, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { filterGalleryImages } from '@/lib/imageValidation';
import { toast } from 'sonner';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { ProductImageViewer } from '@/components/shop/ProductImageViewer';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { PriceBreakdown } from '@/components/shop/PriceBreakdown';
import { ProductGrid } from '@/components/shop/ProductGrid';
import { ProductReviews } from '@/components/shop/ProductReviews';
import { SEOHead } from '@/components/SEOHead';
import { Product } from '@/components/shop/ProductCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useShopCart } from '@/contexts/ShopCartContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
import { cachedCatalogFetch } from '@/lib/catalogCache';
import { resizeImageUrl, imageQualityScore, IMAGE_SIZE_HERO, IMAGE_SIZE_THUMB } from '@/lib/imageResize';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

/**
 * Determine if a product is a vehicle listing.
 * PRIMARY: uses authoritative categoryKey from the database (zero false positives).
 * FALLBACK: strict title heuristic only for items without category data.
 */
function isVehicleProduct(product: { title: string; priceUsd?: number; categoryKey?: string | null; vehiclesSubkey?: string | null }): boolean {
  // PRIMARY: authoritative DB category — definitive, no guessing
  if (product.categoryKey?.startsWith('vehicle')) return true;
  if (product.vehiclesSubkey) return true;

  // FALLBACK: title heuristic for items missing category data
  // Intentionally very strict: requires ALL of year + brand + body type
  const lower = product.title.toLowerCase();

  // Exclusions: accessories, parts, toys, etc.
  const exclusions = ['charger', 'mount', 'holder', 'brake pad', 'oil filter',
    'toy car', 'diecast', 'model car', 'rc car', 'hot wheels', 'key fob',
    'floor mat', 'seat cover', 'car wash', 'phone holder', 'emblem', 'badge',
    'stereo', 'radio', 'navigation', 'dashcam', 'dash cam', 'speaker', 'amplifier',
    'subwoofer', 'gps', 'bluetooth', 'adapter', 'cable', 'obd', 'scanner',
    'tablet', 'touchscreen', 'display', 'laptop', 'computer', 'macbook', 'dell',
    'hp ', 'lenovo', 'asus', 'acer', 'msi', 'razer', 'thinkpad', 'chromebook',
    'generator', 'lawn mower', 'power washer', 'pressure washer', 'engine oil',
    'helmet', 'jacket', 'gloves', 'boots', 'gear', 'accessories', 'parts',
    'cover', 'case', 'protector', 'sticker', 'decal', 'watch', 'rolex',
    'omega', 'breitling', 'cartier', 'jewelry', 'necklace', 'ring', 'bracelet',
    'miniature', 'collectible', 'figurine', 'keychain', 'ornament', 'poster'];
  if (exclusions.some(e => lower.includes(e))) return false;

  // "For Toyota", "Compatible with", "Fits" = accessory
  const accessoryPatterns = /\b(compatible\s+with|fits|replacement\s+for|designed\s+for|made\s+for|for\s+(toyota|honda|ford|chevrolet|chevy|nissan|bmw|mercedes|audi|tesla|jeep|hyundai|kia|subaru|mazda|volkswagen|lexus|porsche|dodge|ram|gmc))\b/i;
  if (accessoryPatterns.test(product.title)) return false;

  const brands = ['toyota', 'honda', 'ford', 'chevrolet', 'chevy', 'nissan',
    'bmw', 'mercedes', 'audi', 'tesla', 'jeep', 'hyundai', 'kia', 'subaru',
    'mazda', 'volkswagen', 'lexus', 'porsche', 'dodge', 'ram', 'gmc',
    'land rover', 'range rover', 'volvo', 'buick', 'cadillac', 'lincoln',
    'ducati', 'harley', 'kawasaki', 'yamaha', 'suzuki', 'indian'];

  const bodyTypes = ['sedan', 'suv', 'truck', 'coupe', 'hatchback', 'convertible',
    'minivan', 'wagon', 'pickup', 'crossover', '4x4', 'motorcycle'];

  const hasYear = /\b(19|20)\d{2}\b/.test(product.title);
  const hasBrand = brands.some(b => lower.includes(b));
  const hasBodyType = bodyTypes.some(b => lower.includes(b));

  // Require ALL THREE: year + brand + body type
  return hasYear && hasBrand && hasBodyType;
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
  categoryKey?: string | null;
  vehiclesSubkey?: string | null;
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
  const [searchParams] = useSearchParams();
  const isHotParam = searchParams.get('hot') === '1';

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
  const [hotProductPrice, setHotProductPrice] = useState<number | null>(
    typeof (location.state as any)?.hotProductPrice === 'number'
      ? (location.state as any).hotProductPrice
      : null
  );
  const [hotPriceLookupDone, setHotPriceLookupDone] = useState(!isHotParam);
  const navProductRef = useRef<ProductData | null>(null);
  const didAutoSelectRef = useRef(false);
  const userInteractedRef = useRef(false);
  const retryAttemptedRef = useRef(false);
  const failedImageIndexesRef = useRef<Set<number>>(new Set());
  const triedOriginalSourceRef = useRef<Set<number>>(new Set());

  const isFixedPrice = !!(location.state as any)?.isFixedPrice || hotProductPrice !== null || (isHotParam && !hotPriceLookupDone);

  const isVehicleFromState = !!(
    (location.state as any)?.product?.isVehicle ||
    (location.state as any)?.isVehicle ||
    (location.state as any)?.categoryKey?.includes('vehicle') ||
    (location.state as any)?.subtabKey?.includes('vehicle')
  );
  const isVehicle = isVehicleFromState || (product ? isVehicleProduct(product) : false);

  // Safe accessors
  const safeImages = useMemo(() => {
    if (product?.images?.length) {
      const filtered = filterGalleryImages(product.images);
      return filtered.length > 0 ? filtered : ['/placeholder.svg'];
    }
    return ['/placeholder.svg'];
  }, [product?.images]);

  const safeImageIndex = Math.min(currentImageIndex, safeImages.length - 1);

  const getNextAvailableImageIndex = useCallback((fromIndex: number) => {
    if (safeImages.length <= 1) return -1;
    for (let offset = 1; offset < safeImages.length; offset += 1) {
      const candidate = (fromIndex + offset) % safeImages.length;
      if (!failedImageIndexesRef.current.has(candidate)) return candidate;
    }
    return -1;
  }, [safeImages.length]);

  const advanceToNextImage = useCallback((failedIndex: number) => {
    failedImageIndexesRef.current.add(failedIndex);
    const nextIndex = getNextAvailableImageIndex(failedIndex);
    if (nextIndex >= 0 && nextIndex !== safeImageIndex) {
      setCurrentImageIndex(nextIndex);
      return true;
    }
    return false;
  }, [getNextAvailableImageIndex, safeImageIndex]);

  const handleHeroImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const activeUrl = safeImages[safeImageIndex] || '/placeholder.svg';
    const currentSrc = e.currentTarget.currentSrc || e.currentTarget.src;
    const triedOriginal = triedOriginalSourceRef.current.has(safeImageIndex);

    if (!triedOriginal && activeUrl !== '/placeholder.svg' && currentSrc !== activeUrl) {
      triedOriginalSourceRef.current.add(safeImageIndex);
      e.currentTarget.src = activeUrl;
      return;
    }

    const switched = advanceToNextImage(safeImageIndex);
    if (!switched) {
      e.currentTarget.src = '/placeholder.svg';
    }
  }, [safeImages, safeImageIndex, advanceToNextImage]);

  useEffect(() => {
    failedImageIndexesRef.current.clear();
    triedOriginalSourceRef.current.clear();
  }, [safeImages]);

  // Preload only the first image at hero size
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
    didAutoSelectRef.current = false;
    userInteractedRef.current = false;
    retryAttemptedRef.current = false;
    failedImageIndexesRef.current.clear();
    triedOriginalSourceRef.current.clear();
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

        const apiUrl = new URL(`${SUPABASE_URL}/functions/v1/catalog-product`);
        apiUrl.searchParams.set('provider', normalizedProvider);
        apiUrl.searchParams.set('id', cleanProductId);
        if (normalizedProvider === 'amazon') {
          apiUrl.searchParams.set('amazon_domain', 'amazon.com');
        }

        const response = await fetch(apiUrl.toString(), {
          signal: controller.signal,
          headers: {
            'apikey': SUPABASE_ANON_KEY,
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
          const newImages: string[] = item.images || item.imageUrls || (item.image_url ? [item.image_url] : []);
          let mergedImages: string[];

          if (newImages.length > 0) {
            // Fetched gallery is source of truth — don't pin old nav thumbnail first
            const seen = new Set(newImages);
            mergedImages = [...newImages];
            // Append any previous images not already present (deduped)
            if (prev?.images) {
              for (const img of prev.images) {
                if (img && img !== '/placeholder.svg' && !seen.has(img)) {
                  mergedImages.push(img);
                  seen.add(img);
                }
              }
            }
          } else if (prev?.images?.length) {
            mergedImages = prev.images;
          } else {
            mergedImages = ['/placeholder.svg'];
          }

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
            categoryKey: item.categoryKey || prev?.categoryKey || null,
            vehiclesSubkey: item.vehiclesSubkey || prev?.vehiclesSubkey || null,
            variants: item.variants || undefined,
          };
        });

        // Force image index to 0 (best API image) when gallery arrives, unless user interacted
        const finalImages: string[] = item.images || item.imageUrls || [];
        if (finalImages.length > 0 && !userInteractedRef.current) {
          setCurrentImageIndex(0);
          didAutoSelectRef.current = true;
        }

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

        // Phase 3A: Retry once with alternate ID form if first fetch failed
        if (!retryAttemptedRef.current) {
          retryAttemptedRef.current = true;
          console.log('[ProductDetails] retrying with alternate ID derivation');
          try {
            const productIdDecoded = decodeURIComponent(id);
            const normalizedProvider = provider.toLowerCase() === 'rainforest' ? 'amazon' : provider.toLowerCase();
            // Try with raw ID (no prefix stripping)
            const retryUrl = new URL(`${SUPABASE_URL}/functions/v1/catalog-product`);
            retryUrl.searchParams.set('provider', normalizedProvider);
            retryUrl.searchParams.set('id', productIdDecoded);
            if (normalizedProvider === 'amazon') {
              retryUrl.searchParams.set('amazon_domain', 'amazon.com');
            }
            const retryResp = await fetch(retryUrl.toString(), {
              signal: controller.signal,
              headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Content-Type': 'application/json',
              },
            });
            if (retryResp.ok) {
              const retryData = await retryResp.json();
              if (retryData?.item) {
                const item = retryData.item;
                const newImages: string[] = item.images || item.imageUrls || (item.image_url ? [item.image_url] : []);
                setProduct(prev => ({
                  id: item.provider_product_id || item.id || prev?.id || '',
                  provider: item.provider || provider || prev?.provider || '',
                  title: item.title || prev?.title || 'Product',
                  description: item.description || prev?.description,
                  images: newImages.length > 0 ? newImages : (prev?.images || ['/placeholder.svg']),
                  priceUsd: item.price_usd || item.priceUsd || prev?.priceUsd || 0,
                  rating: item.rating ?? prev?.rating,
                  reviewCount: item.review_count || item.reviewCount || prev?.reviewCount,
                  inStock: item.in_stock !== false,
                  productUrl: item.product_url || item.productUrl || prev?.productUrl,
                  brand: item.brand || prev?.brand,
                  categoryKey: item.categoryKey || prev?.categoryKey || null,
                  vehiclesSubkey: item.vehiclesSubkey || prev?.vehiclesSubkey || null,
                  variants: item.variants || undefined,
                }));
                console.log('[ProductDetails] retry succeeded with alternate ID');
                return;
              }
            }
          } catch {
            // Retry also failed — fall through to error handling
          }
        }

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
        // Use first 4 meaningful words (skip short filler words) for better relevance
        const meaningful = title.split(/[\s,\-]+/).filter(w => w.length > 2).slice(0, 4).join(' ');
        const keywords = meaningful || title.split(' ').slice(0, 3).join(' ');
        const similarData = await cachedCatalogFetch<any>('catalog-search', {
          q: keywords.trim().toLowerCase(),
          limit: 13,
        });

        if (controller.signal.aborted) return;
        if (similarData?.items) {
          const currentId = product?.id || id;
          setSimilarProducts(
            similarData.items
              .filter((i: any) => (i.provider_product_id || i.id) !== currentId)
              .slice(0, 12)
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
  }, [product?.title, provider, id]);

  // Check if this product is a hot product (fixed price, no extra markup/shipping)
  // Always query DB so direct links without ?hot=1 still show all-inclusive pricing
  // Uses both product.id AND the URL id param as fallback for robustness
  useEffect(() => {
    if ((location.state as any)?.isFixedPrice && typeof (location.state as any)?.hotProductPrice === 'number') {
      setHotProductPrice((location.state as any).hotProductPrice);
      setHotPriceLookupDone(true);
      return;
    }

    // Use URL id param as primary lookup key (always available), fall back to product.id
    const lookupId = id || product?.id;
    const lookupProvider = provider?.toLowerCase() === 'rainforest' ? 'amazon' : (provider?.toLowerCase() || product?.provider);
    if (!lookupId || !lookupProvider) return;

    // Clean the ID the same way the product fetch does
    let cleanId = decodeURIComponent(lookupId);
    if (lookupProvider === 'amazon' && cleanId.toLowerCase().startsWith('amazon_')) {
      cleanId = cleanId.slice(7);
    } else if (lookupProvider === 'ebay' && cleanId.toLowerCase().startsWith('ebay_')) {
      cleanId = cleanId.slice(5);
    }

    supabase
      .from('hot_products_showcase')
      .select('total_price_usd')
      .eq('provider_product_id', cleanId)
      .eq('provider', lookupProvider)
      .eq('is_active', true)
      .maybeSingle()
      .then(({ data }) => {
        setHotProductPrice(typeof data?.total_price_usd === 'number' ? data.total_price_usd : null);
        setHotPriceLookupDone(true);
      });
  }, [location.state, product?.id, product?.provider, id, provider]);

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
        priceUsd: isFixedPrice ? hotProductPrice! : product.priceUsd,
        quantity,
        productUrl: product.productUrl,
        ...(isFixedPrice ? { isFixedPrice: true } : {}),
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
      const { error } = await supabase.functions.invoke('mobile-orders', {
        body: { action: 'request_quote', locale: language }
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
        priceUsd: clickedVariant.price?.value ?? prev.priceUsd,
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
          `${SUPABASE_URL}/functions/v1/catalog-product`
        );
        apiUrl.searchParams.set('provider', 'amazon');
        apiUrl.searchParams.set('id', asin);
        apiUrl.searchParams.set('amazon_domain', 'amazon.com');

        const resp = await fetch(apiUrl.toString(), {
          headers: {
            apikey: SUPABASE_ANON_KEY,
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

  const nextImage = () => { userInteractedRef.current = true; setCurrentImageIndex(prev => (prev + 1) % safeImages.length); };
  const prevImage = () => { userInteractedRef.current = true; setCurrentImageIndex(prev => (prev - 1 + safeImages.length) % safeImages.length); };

  if (loading) {
    return (
      <div className="min-h-screen bg-black overflow-x-hidden">
        <ShopHeader />
        <div className="pt-20 sm:pt-24 px-3 sm:px-4">
          <div className="mx-auto max-w-6xl w-full">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
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
      <div className="min-h-screen bg-black overflow-x-hidden">
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
    <div className="min-h-screen bg-black overflow-x-hidden">
      <ShopHeader />

      {product && (
        <SEOHead
          title={product.title}
          description={`Buy ${product.title} from AfriShop - delivered to DR Congo`}
          image={product.images?.[0]}
          type="product"
          price={product.priceUsd}
          availability={product.inStock ? 'in stock' : 'out of stock'}
        />
      )}
      <main className="pt-20 sm:pt-24 px-3 sm:px-4 pb-safe-nav">
        <div className="mx-auto max-w-6xl w-full">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-6 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Shop
          </Link>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-12">
            {/* Image Gallery */}
            <div className="space-y-3 sm:space-y-4 min-w-0">
              <div
                data-product-hero="true"
                className="relative w-full aspect-square sm:aspect-[4/3] bg-white rounded-2xl overflow-hidden border border-white/10 cursor-pointer flex items-center justify-center touch-pan-y max-w-full"
                onClick={() => setLightboxOpen(true)}
                onTouchStart={(e) => {
                  const touch = e.touches[0];
                  (e.currentTarget as any)._swipeStartX = touch.clientX;
                  (e.currentTarget as any)._swipeStartY = touch.clientY;
                }}
                onTouchEnd={(e) => {
                  const startX = (e.currentTarget as any)._swipeStartX;
                  const startY = (e.currentTarget as any)._swipeStartY;
                  if (startX == null) return;
                  const touch = e.changedTouches[0];
                  const dx = touch.clientX - startX;
                  const dy = touch.clientY - startY;
                  if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
                    e.preventDefault();
                    userInteractedRef.current = true;
                    if (dx < 0) nextImage();
                    else prevImage();
                  }
                }}
              >
                <img
                  key={safeImages[safeImageIndex]}
                  src={resizeImageUrl(safeImages[safeImageIndex] || '/placeholder.svg', IMAGE_SIZE_HERO)}
                  alt={product.title}
                  loading="eager"
                  fetchPriority="high"
                  decoding="async"
                  className="max-w-full max-h-full object-contain p-4 sm:p-8 pointer-events-none select-none"
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    const { naturalWidth: w, naturalHeight: h } = img;
                    if (w > 0 && h > 0) {
                      const ratio = w / h;
                      if (ratio > 1.9 || ratio < 0.5 || (w < 80 && h < 80) || (w >= 900 && h <= 320)) {
                        const switched = advanceToNextImage(safeImageIndex);
                        if (!switched) {
                          img.src = '/placeholder.svg';
                        }
                      }
                    }
                  }}
                  onError={handleHeroImageError}
                />

                {safeImages.length > 1 && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); prevImage(); }}
                      className="absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/50 text-white hover:bg-black/70 hidden sm:flex"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); nextImage(); }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/50 text-white hover:bg-black/70 hidden sm:flex"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </Button>

                    {/* Dot indicators for swipe */}
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 sm:hidden">
                      {safeImages.map((_, i) => (
                        <div
                          key={i}
                          className={`w-2 h-2 rounded-full transition-colors ${
                            i === safeImageIndex ? 'bg-primary' : 'bg-black/30'
                          }`}
                        />
                      ))}
                    </div>
                  </>
                )}

                <Badge variant="outline" className={`absolute top-4 left-4 capitalize ${providerColor}`}>
                  {displayProvider === 'amazon' ? 'Amazon' : displayProvider === 'ebay' ? 'eBay' : displayProvider}
                </Badge>
              </div>

              {safeImages.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                  {safeImages.map((img, index) => (
                    <button
                      key={index}
                      onClick={() => { userInteractedRef.current = true; setCurrentImageIndex(index); }}
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
                        className="w-full h-full object-contain bg-white p-1"
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = '/placeholder.svg';
                        }}
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Product Info */}
            <div className="space-y-5 sm:space-y-6 min-w-0">
              {product.brand && (
                <p className="text-sm text-white/60 uppercase tracking-wider">
                  {product.brand}
                </p>
              )}

              <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-white break-words min-w-0">
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
              <div className="bg-white/5 rounded-2xl p-4 sm:p-6 border border-white/10 min-w-0">
                <PriceBreakdown
                  itemPriceUsd={isFixedPrice ? hotProductPrice! : displayPrice}
                  quantity={quantity}
                  isVehicle={isVehicle}
                  isFixedPrice={isFixedPrice}
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
                  <p className="text-white/70 whitespace-pre-line break-words">{product.description}</p>
                </div>
              )}

              {/* Customer Reviews */}
              <ProductReviews productId={product?.id || id || ''} provider={product?.provider || provider || ''} />
            </div>
          </div>

          {/* Similar Products */}
          {similarProducts.length > 0 && (
            <section className="mt-16">
              <h2 className="text-xl font-bold text-foreground mb-6">
                {language === 'fr' ? 'Produits similaires' : 'Similar Products'}
              </h2>
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
          onIndexChange={(i) => { userInteractedRef.current = true; setCurrentImageIndex(i); }}
        />
      )}

      <BottomNavigation />
    </div>
  );
}
