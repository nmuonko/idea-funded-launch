import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { prefetchCatalogCategory, clearAllCatalogCache } from '@/lib/catalogCache';
import { Clock, Loader2, Link2, ArrowRight } from 'lucide-react';
import { LazySection } from '@/components/shop/LazySection';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { SectionBlock } from '@/components/shop/SectionBlock';
import { HeroBannerCarousel } from '@/components/shop/HeroBannerCarousel';
import { CategoryIconsRow } from '@/components/shop/CategoryIconsRow';
import { GazelleHero } from '@/components/shop/GazelleHero';
import { AvailableInRow } from '@/components/shop/AvailableInRow';
import { ShopFooter } from '@/components/shop/ShopFooter';
import { HorizontalProductRow } from '@/components/shop/HorizontalProductRow';
import { Product, ProductCard } from '@/components/shop/ProductCard';
import { PhoneCard } from '@/components/shop/PhoneCard';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cachedCatalogFetch } from '@/lib/catalogCache';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { translations } from '@/lib/i18n/translations';
import { getRecentlyViewed } from '@/lib/recentlyViewed';
import { isRenderableImageUrl } from '@/lib/imageValidation';
import { supabase } from '@/integrations/supabase/client';
import { applyServerPrices, resolveDisplayPrice } from '@/lib/serverPricing';

// Import static data and helpers from extracted module
import {
  CATEGORY_TITLE_MAP,
  CATEGORY_SEARCH_QUERIES,
  CATEGORY_KEYWORDS,
  CATEGORY_EXCLUDE_KEYWORDS,
  CATEGORY_FILTER_OPTIONS,
  ALL_HOMEPAGE_CATEGORIES,
  PROMO_CATEGORIES,
  PROVIDER_DISPLAY,
  
  CONCURRENCY_LIMIT,
  CURATED_CACHE_TTL_MS,
  MODE_OVERRIDE_QUERIES,
  LUXURY_KEYWORDS,
  getEffectiveExcludes,
  isRelevantToCategory,
  getCategoryTitle,
  filterForCategory,
  sortByLuxury,
  deduplicateProducts,
  runWithConcurrency,
} from '@/lib/categoryConfig';

interface HomeFeedResponse {
  ok: boolean;
  sections: Array<{
    key: string;
    title: string;
    hideTitle?: boolean;
    items: Array<{
      id?: string;
      provider_product_id?: string;
      provider?: string;
      title?: string;
      image_url?: string;
      imageUrl?: string;
      price_usd?: number;
      priceUsd?: number;
      rating?: number;
      in_stock?: boolean;
      product_url?: string;
    }>;
  }>;
  page?: number;
  pageSize?: number;
  totalItems?: number;
  hasMore?: boolean;
  totalPages?: number;
  _meta?: { source?: string; poolSize?: number; isStale?: boolean };
}

const SLOW_CATEGORIES = new Set(ALL_HOMEPAGE_CATEGORIES);
// Homepage cap: nothing over $500 (business decision — affordable, clean look).
// Vehicles/cars are exempt because they have their own dedicated section/pricing.
const HOMEPAGE_DEFAULT_MAX_PRICE_USD = 150;
const HOMEPAGE_CATEGORY_MAX_PRICE_USD: Record<string, number> = {
  phones: 300,
  electronics: 250,
  audio_music: 120,
  gaming: 300,
  cameras: 400,
  cameras_photo: 400,
  refurbished: 350,
  jewelry_watches: 200,
  vehicles: 8000,
  cars: 8000,
};
// Categories exempt from the $500 ceiling (vehicles only).
const HOMEPAGE_PRICE_EXEMPT_CATEGORIES = new Set<string>(['vehicles', 'cars']);
const HOMEPAGE_PRICE_EXEMPT_PROVIDERS = new Set(['cargurus', 'carvana', 'ebay_motors']);
// Hard ceiling enforced for non-exempt categories.
const HOMEPAGE_HARD_PRICE_CEILING_USD = 500;
const CURATED_CATEGORY_CACHE_PREFIX = 'afrishop_curated_v6';

function getCategoryMaxPrice(categoryKey?: string): number {
  if (!categoryKey) return HOMEPAGE_DEFAULT_MAX_PRICE_USD;
  return HOMEPAGE_CATEGORY_MAX_PRICE_USD[categoryKey] ?? HOMEPAGE_DEFAULT_MAX_PRICE_USD;
}

function isHomepagePriceAllowed(product: Product, categoryKey?: string): boolean {
  const provider = (product.provider || '').toLowerCase();
  const price = Number(product.priceUsd || 0);
  // Vehicles / car providers are exempt from the $500 hard ceiling.
  if (categoryKey && HOMEPAGE_PRICE_EXEMPT_CATEGORIES.has(categoryKey)) return true;
  if (HOMEPAGE_PRICE_EXEMPT_PROVIDERS.has(provider)) return true;
  // Hard global ceiling — homepage never shows items over $500.
  if (price > 0 && price > HOMEPAGE_HARD_PRICE_CEILING_USD) return false;
  const cap = getCategoryMaxPrice(categoryKey);
  // Unknown/zero price kept; only confirmed-over-cap items dropped.
  if (price > 0 && price > cap) return false;
  return true;
}

function filterHomepageProducts(products: Product[], categoryKey?: string): Product[] {
  return products.filter(product => isHomepagePriceAllowed(product, categoryKey));
}

function keepEnoughHomepageProducts(products: Product[], categoryKey?: string, minimum = 4): Product[] {
  const capped = filterHomepageProducts(products, categoryKey);
  if (capped.length >= minimum) return capped;

  const cappedIds = new Set(capped.map(p => p.id));
  const overCapBackfill = products.filter(p => !cappedIds.has(p.id));
  return [...capped, ...overCapBackfill].slice(0, Math.min(minimum, products.length));
}

function getCachedCategoryResult(catKey: string): Product[] | null {
  try {
    const raw = localStorage.getItem(`${CURATED_CATEGORY_CACHE_PREFIX}:${catKey}`);
    if (!raw) return null;
    const { items, ts } = JSON.parse(raw);
    if (Date.now() - ts > CURATED_CACHE_TTL_MS) return null;
    if (!Array.isArray(items) || items.length === 0) return null;
    return keepEnoughHomepageProducts(items, catKey);
  } catch { return null; }
}

function setCachedCategoryResult(catKey: string, items: Product[]) {
  try {
    const filteredItems = keepEnoughHomepageProducts(items, catKey);
    if (filteredItems.length > 0) {
      localStorage.setItem(`${CURATED_CATEGORY_CACHE_PREFIX}:${catKey}`, JSON.stringify({ items: filteredItems, ts: Date.now() }));
    }
  } catch { /* quota exceeded, ignore */ }
}

// ====== HELPERS ======

const mapItemToProduct = (item: HomeFeedResponse['sections'][0]['items'][0]): Product => {
  const rawImage = item.image_url || item.imageUrl || '';
  return {
    id: item.provider_product_id || item.id || '',
    provider: item.provider || 'amazon',
    title: item.title || 'Product',
    imageUrl: isRenderableImageUrl(rawImage) ? rawImage : '',
    priceUsd: item.price_usd || item.priceUsd || 0,
    rating: item.rating,
    inStock: item.in_stock !== false,
    productUrl: item.product_url,
  };
};

const parsePrice = (item: any): number => {
  const candidates = [
    item.priceUsd, item.price_usd, item.price,
    item.sellingStatus?.currentPrice?.value,
    item.offer?.price, item.offers?.[0]?.price,
  ];
  for (const v of candidates) {
    if (v == null) continue;
    if (typeof v === 'number' && v > 0) return v;
    if (typeof v === 'string') {
      const n = parseFloat(v.replace(/[$,]/g, ''));
      if (!isNaN(n) && n > 0) return n;
    }
  }
  return 0;
};

const mapSearchItemToProduct = (item: any): Product => {
  const rawImage = item.imageUrl || item.mainImageUrl || item.image_url || item.image || '';
  return {
    id: item.id || item.providerProductId || item.provider_product_id || item.itemId || item.asin || item.productUrl || item.product_url || item.url || '',
    provider: item.provider === 'rainforest' ? 'amazon' : (item.provider || 'amazon'),
    title: item.title || 'Product',
    imageUrl: isRenderableImageUrl(rawImage) ? rawImage : '',
    priceUsd: parsePrice(item),
    rating: item.rating,
    inStock: item.inStock !== false,
    productUrl: item.productUrl || item.product_url || item.url,
  };
};

const isValidProduct = (p: Product) => !!p.id && p.priceUsd > 0 && !!p.imageUrl && isRenderableImageUrl(p.imageUrl);

async function searchCategoryRescue(catKey: string, currentItems: Product[], minimum = 4): Promise<Product[]> {
  const seenIds = new Set(currentItems.map(product => product.id));
  const rescued = [...currentItems];
  const queries = CATEGORY_SEARCH_QUERIES[catKey] || [catKey.replace('_', ' ')];

  // First pass: strict — must match category keywords/excludes
  for (const q of queries) {
    if (rescued.length >= Math.max(minimum, 8)) break;
    try {
      const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 24, client: 'web' });
      const candidates = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct);
      const relevant = filterForCategory(candidates, catKey);
      for (const product of relevant) {
        if (rescued.length >= Math.max(minimum, 8)) break;
        if (seenIds.has(product.id)) continue;
        seenIds.add(product.id);
        rescued.push(product);
      }
    } catch { /* try next */ }
  }

  // Second pass (relaxed): if still short, accept search results as-is from seed queries
  if (rescued.length < minimum) {
    for (const q of queries) {
      if (rescued.length >= minimum) break;
      try {
        const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 16, client: 'web' });
        const candidates = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct);
        for (const product of candidates) {
          if (rescued.length >= minimum) break;
          if (seenIds.has(product.id)) continue;
          seenIds.add(product.id);
          rescued.push(product);
        }
      } catch { /* try next */ }
    }
  }

  return keepEnoughHomepageProducts(deduplicateProducts(sortByLuxury(rescued)), catKey);
}

const extractFirstImageFromJson = (images: any): string | null => {
  const readCandidates = (obj: any): string[] => {
    if (!obj || typeof obj !== 'object') return [];
    return [obj.url, obj.image, obj.src, obj.large, obj.hiRes, obj.hi_res, obj.main].filter((v): v is string => typeof v === 'string');
  };

  if (Array.isArray(images)) {
    for (const img of images) {
      if (typeof img === 'string' && isRenderableImageUrl(img)) return img;
      for (const candidate of readCandidates(img)) {
        if (isRenderableImageUrl(candidate)) return candidate;
      }
    }
    return null;
  }

  if (images && typeof images === 'object') {
    for (const candidate of readCandidates(images)) {
      if (isRenderableImageUrl(candidate)) return candidate;
    }
  }

  return null;
};

const deriveProviderImageFallback = (provider: string, providerProductId?: string | null): string | null => {
  if (!providerProductId) return null;
  const p = provider.toLowerCase();
  if (p === 'carvana') {
    return `https://vexgateway.fastly.carvana.io/${providerProductId}/standardizedHero.jpg?width=800`;
  }
  return null;
};

export default function ShopHome() {
  const { language } = useLanguage();
  const { user } = useAuth();

  const t = translations[language] || translations.en;
  const shop = t.shop;

  // ====== STATE ======
  const [accueilProducts, setAccueilProducts] = useState<Product[]>([]);
  const [accueilLoading, setAccueilLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const [pinnedByCategory, setPinnedByCategory] = useState<Record<string, Product[]>>({});
  const pinnedFetchedRef = useRef(false);

  const [categoryItems, setCategoryItems] = useState<Record<string, Product[]>>({});
  const [categoryLoadingMap, setCategoryLoadingMap] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    ALL_HOMEPAGE_CATEGORIES.forEach(k => { init[k] = true; });
    return init;
  });

  const [recentlyViewed, setRecentlyViewed] = useState<Product[]>([]);
  const [providerFilter, setProviderFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortBy, setSortBy] = useState<'cheapest' | 'newest' | 'priciest'>('cheapest');
  const fetchedRef = useRef(false);
  const [dynamicStores, setDynamicStores] = useState<{ value: string; label: string; count: number }[]>([]);

  // Dedicated bulk phones fetch (independent from curated category items)
  const [bulkPhones, setBulkPhones] = useState<Product[]>([]);
  const [bulkPhonesLoading, setBulkPhonesLoading] = useState(false);
  const [bulkPhonesPage, setBulkPhonesPage] = useState(0);
  const [bulkPhonesTotal, setBulkPhonesTotal] = useState(0);
  const bulkPhonesFetchedRef = useRef(false);
  // Cache fetched pages so navigating back to a previously viewed page is instant
  const bulkPhonesPageCacheRef = useRef<Record<number, { items: Product[]; total: number }>>({});

  const [storeProducts, setStoreProducts] = useState<Product[]>([]);
  const [storeProductsLoading, setStoreProductsLoading] = useState(false);
  const [storeTotalCount, setStoreTotalCount] = useState(0);
  const [storeProductsPage, setStoreProductsPage] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const [categoryProducts, setCategoryProducts] = useState<Product[]>([]);
  const [categoryProductsLoading, setCategoryProductsLoading] = useState(false);
  const [categoryTotalCount, setCategoryTotalCount] = useState(0);
  const [categoryProductsPage, setCategoryProductsPage] = useState(0);
  const [categoryLoadingMore, setCategoryLoadingMore] = useState(false);
  const categoryProductsCacheRef = useRef<Record<string, { products: Product[]; count: number }>>({});

  const storeProductsCacheRef = useRef<Record<string, { products: Product[]; count: number }>>({});

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await supabase.rpc('get_active_providers');
        if (error) throw error;
        if (!data) return;
        const mergedMap = new Map<string, number>();
        for (const row of data as { provider: string; item_count: number }[]) {
          const key = row.provider === 'rainforest' ? 'amazon' : row.provider;
          mergedMap.set(key, (mergedMap.get(key) || 0) + Number(row.item_count));
        }
        const stores = Array.from(mergedMap.entries())
          .filter(([p]) => p && p !== '')
          .map(([p, count]) => ({
            value: p,
            label: PROVIDER_DISPLAY[p] || p.charAt(0).toUpperCase() + p.slice(1),
            count,
          }))
          .filter(s => s.count > 0)
          .sort((a, b) => b.count - a.count);

        setDynamicStores(stores);
      } catch (e) { console.warn('[ShopHome] Failed to fetch providers:', e); }
    })();
  }, []);

  // Bulk phones fetch — pulls real phone listings directly from DB
  // Numeric pagination: 50 per page, replaces (no append) so users navigate via page numbers.
  const PHONES_PAGE_SIZE = 50;
  const fetchBulkPhones = useCallback(async (page: number, background = false) => {
    // Instant return from cache — no spinner, no refetch
    const cached = bulkPhonesPageCacheRef.current[page];
    if (cached) {
      if (!background) {
        setBulkPhones(cached.items);
        setBulkPhonesTotal(cached.total);
      }
      return;
    }
    const from = page * PHONES_PAGE_SIZE;
    if (!background) setBulkPhonesLoading(true);
    try {
      const phoneOr = [
        'title.ilike.%iphone 11%',
        'title.ilike.%iphone 12%',
        'title.ilike.%iphone 13%',
        'title.ilike.%iphone 14%',
        'title.ilike.%iphone 15%',
        'title.ilike.%iphone 16%',
        'title.ilike.%iphone se%',
        'title.ilike.%galaxy s21%',
        'title.ilike.%galaxy s22%',
        'title.ilike.%galaxy s23%',
        'title.ilike.%galaxy s24%',
        'title.ilike.%galaxy s25%',
        'title.ilike.%galaxy note%',
        'title.ilike.%galaxy z fold%',
        'title.ilike.%galaxy z flip%',
        'title.ilike.%pixel 7%',
        'title.ilike.%pixel 8%',
        'title.ilike.%pixel 9%',
        'title.ilike.%oneplus %',
      ].join(',');

      // Skip the expensive count after the first page — it's the slow part of pagination.
      const wantCount = bulkPhonesTotal === 0;
      const { data, error, count } = await supabase
        .from('catalog_items')
        .select(
          'id, provider, provider_product_id, title, image_url, images, product_url, price_usd, rating, in_stock',
          wantCount ? { count: 'exact' } : {}
        )
        .eq('is_active', true)
        .eq('is_disallowed', false)
        .gte('price_usd', 80)
        .lte('price_usd', 1800)
        .in('provider', ['amazon', 'rainforest'])
        .or(phoneOr)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .range(from, from + PHONES_PAGE_SIZE - 1);
      if (error) throw error;

      const ACCESSORY_RE = /\b(case|cover|protector|tempered glass|charger|cable|usb-?c|lightning|magsafe|airpods|earbud|earphone|power bank|holder|mount|stand|adapter|wireless charger|screen|skin|wrap|sleeve|pouch|wallet|lanyard|strap|grip|popsocket|stylus|lens|tripod|selfie|car mount|otterbox|spigen|for iphone|for samsung|for galaxy|for pixel|replacement|repair|battery|sim |sim-|sim card|tray|button|speaker only|microphone|housing|frame|bezel|backplate|back plate|back glass|lcd|digitizer|oem part|verre|protection|étui|coque)\b/i;
      const mapped = (data || [])
        .map((item: any): Product | null => {
          const fallback = extractFirstImageFromJson(item.images);
          const preferred = fallback || (isRenderableImageUrl(item.image_url) ? item.image_url : null);
          if (!preferred || !isRenderableImageUrl(preferred)) return null;
          const tt = (item.title || '').toLowerCase();
          if (ACCESSORY_RE.test(tt)) return null;
          const gallery = Array.isArray(item.images)
            ? item.images
                .flatMap((img: any) => {
                  if (typeof img === 'string') return [img];
                  if (!img || typeof img !== 'object') return [];
                  return [img.url, img.image, img.src, img.large, img.hiRes, img.hi_res, img.main].filter(
                    (v): v is string => typeof v === 'string'
                  );
                })
                .filter(Boolean)
            : [];
          return {
            id: item.provider_product_id || item.id,
            provider: item.provider || 'amazon',
            title: item.title || 'Phone',
            imageUrl: preferred,
            images: gallery,
            imageUrls: gallery,
            priceUsd: item.price_usd || 0,
            rating: item.rating,
            inStock: item.in_stock !== false,
            productUrl: item.product_url,
          };
        })
        .filter((p): p is Product => p !== null);
      await applyServerPrices(mapped);
      const totalForState = wantCount ? (count || 0) : bulkPhonesTotal;
      bulkPhonesPageCacheRef.current[page] = { items: mapped, total: totalForState };
      if (!background) {
        if (wantCount) setBulkPhonesTotal(count || 0);
        setBulkPhones(mapped);
      } else if (wantCount) {
        setBulkPhonesTotal(count || 0);
      }
    } catch (e) {
      console.warn('[ShopHome] bulk phones fetch failed:', e);
    } finally {
      if (!background) setBulkPhonesLoading(false);
    }
  }, [bulkPhonesTotal]);

  useEffect(() => {
    fetchBulkPhones(bulkPhonesPage);
    if (bulkPhonesFetchedRef.current) {
      // Scroll to grid on page change (skip on initial mount)
      const el = document.getElementById('phones-grid');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    bulkPhonesFetchedRef.current = true;
    // Prefetch next page in background so the next click is instant
    const nextPage = bulkPhonesPage + 1;
    if (!bulkPhonesPageCacheRef.current[nextPage]) {
      const t = setTimeout(() => fetchBulkPhones(nextPage, true), 600);
      return () => clearTimeout(t);
    }
  }, [bulkPhonesPage, fetchBulkPhones]);

  // Fetch products for a specific store from the DB (paginated)
  const fetchStorePage = useCallback(async (provider: string, page: number, append: boolean) => {
    const providerKeys = provider === 'amazon' ? ['rainforest', 'amazon'] : [provider];
    const PAGE_SIZE = 200;
    const from = page * PAGE_SIZE;

    if (!append) setStoreProductsLoading(true);
    else setLoadingMore(true);

    try {
      const { data, error, count } = await supabase
        .from('catalog_items')
        .select(
          'id, provider, provider_product_id, title, image_url, images, product_url, price_usd, rating, in_stock',
          { count: 'exact' }
        )
        .in('provider', providerKeys)
        .eq('is_active', true)
        .eq('is_disallowed', false)
        .gt('price_usd', 0)
        .order('first_seen_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw error;

      const totalCount = count ?? 0;
      const mapped = (data || [])
        .map((item: any): Product | null => {
          const fallbackImage = extractFirstImageFromJson(item.images);
          const providerFallback = deriveProviderImageFallback(item.provider || provider, item.provider_product_id || item.id);
          const preferred = isRenderableImageUrl(item.image_url)
            ? item.image_url
            : (fallbackImage || providerFallback);
          if (!preferred || !isRenderableImageUrl(preferred)) return null;
          return {
            id: item.provider_product_id || item.id,
            provider: item.provider || provider,
            title: item.title || 'Product',
            imageUrl: preferred,
            priceUsd: item.price_usd || 0, // will be resolved below
            rating: item.rating,
            inStock: item.in_stock !== false,
            productUrl: item.product_url,
          };
        })
        .filter((p): p is Product => p !== null);

      // Resolve prices server-side
      await applyServerPrices(mapped);

      if (append) {
        setStoreProducts(prev => {
          const combined = [...prev, ...mapped];
          storeProductsCacheRef.current[provider] = { products: combined, count: totalCount };
          return combined;
        });
      } else {
        setStoreProducts(mapped);
        storeProductsCacheRef.current[provider] = { products: mapped, count: totalCount };
      }
      setStoreTotalCount(totalCount);
    } catch (err) {
      console.warn(`[ShopHome] Store fetch for ${provider} page ${page} failed:`, err);
    } finally {
      setStoreProductsLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (!providerFilter || providerFilter === 'all') {
      setStoreProducts([]);
      setStoreTotalCount(0);
      setStoreProductsPage(0);
      return;
    }

    const cached = storeProductsCacheRef.current[providerFilter];
    if (cached) {
      setStoreProducts(cached.products);
      setStoreTotalCount(cached.count);
      return;
    }

    setStoreProductsPage(0);
    fetchStorePage(providerFilter, 0, false);
  }, [providerFilter, fetchStorePage]);

  const handleLoadMore = useCallback(() => {
    const nextPage = storeProductsPage + 1;
    setStoreProductsPage(nextPage);
    fetchStorePage(providerFilter, nextPage, true);
  }, [storeProductsPage, providerFilter, fetchStorePage]);

  // Fetch category-only products using fast backend category endpoint
  const fetchCategoryPage = useCallback(async (catKey: string, page: number, append: boolean) => {
    const PAGE_SIZE = 200;

    if (!append) setCategoryProductsLoading(true);
    else setCategoryLoadingMore(true);

    try {
      let mapped: Product[] = [];
      let totalCount = 0;

      try {
        const data = await cachedCatalogFetch<any>('catalog-category', {
          category: catKey,
          page: page + 1,
          pageSize: PAGE_SIZE,
          client: 'web',
          language,
        });

        const rawItems = data?.items || data?.sections?.[0]?.items || [];
        totalCount = Number(data?.total || 0);

        mapped = rawItems
          .map((item: any) => mapItemToProduct(item))
          .filter(isValidProduct);

        mapped = filterHomepageProducts(mapped, catKey);
      } catch (endpointErr) {
        console.warn(`[ShopHome] catalog-category fetch for ${catKey} page ${page} failed:`, endpointErr);
      }

      // Fallback for custom categories
      if (mapped.length === 0 && page === 0) {
        const queries = CATEGORY_SEARCH_QUERIES[catKey] || [catKey.replace('_', ' ')];
        const fallbackPool: Product[] = [];

        for (const q of queries.slice(0, 4)) {
          try {
            const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 50, client: 'web' });
            const searchItems = (data?.items || [])
              .map(mapSearchItemToProduct)
              .filter(isValidProduct)
              .filter((p: Product) => isRelevantToCategory(p, catKey));
            fallbackPool.push(...searchItems);
          } catch {
            // Continue with next query
          }
        }

        mapped = filterHomepageProducts(deduplicateProducts(sortByLuxury(fallbackPool)).slice(0, PAGE_SIZE), catKey);
        if (totalCount === 0) totalCount = mapped.length;
      }

      if (append) {
        setCategoryProducts(prev => {
          const combined = filterHomepageProducts(deduplicateProducts([...prev, ...mapped]), catKey);
          categoryProductsCacheRef.current[catKey] = { products: combined, count: Math.max(totalCount, combined.length) };
          return combined;
        });
      } else {
        setCategoryProducts(mapped);
        categoryProductsCacheRef.current[catKey] = { products: mapped, count: Math.max(totalCount, mapped.length) };
      }
      setCategoryTotalCount(Math.max(totalCount, mapped.length));
    } catch (err) {
      console.warn(`[ShopHome] Category fetch for ${catKey} page ${page} failed:`, err);
    } finally {
      setCategoryProductsLoading(false);
      setCategoryLoadingMore(false);
    }
  }, [language]);

  useEffect(() => {
    if (providerFilter && providerFilter !== 'all') return;
    if (!categoryFilter || categoryFilter === 'all') {
      setCategoryProducts([]);
      setCategoryTotalCount(0);
      setCategoryProductsPage(0);
      return;
    }
    const cached = categoryProductsCacheRef.current[categoryFilter];
    if (cached) {
      setCategoryProducts(cached.products);
      setCategoryTotalCount(cached.count);
      setCategoryProductsPage(Math.ceil(cached.products.length / 200));
      return;
    }
    setCategoryProductsPage(0);
    fetchCategoryPage(categoryFilter, 0, false);
  }, [categoryFilter, providerFilter, fetchCategoryPage]);

  const handleCategoryLoadMore = useCallback(() => {
    const nextPage = categoryProductsPage + 1;
    setCategoryProductsPage(nextPage);
    fetchCategoryPage(categoryFilter, nextPage, true);
  }, [categoryProductsPage, categoryFilter, fetchCategoryPage]);

  /** Client-side provider filter helper */
  const filterByProvider = useCallback((items: Product[]) => {
    if (!providerFilter || providerFilter === 'all') return items;
    const filterKey = providerFilter === 'amazon' ? 'rainforest' : providerFilter;
    return items.filter(p => {
      const prov = (p.provider || '').toLowerCase();
      return prov === filterKey || prov === providerFilter;
    });
  }, [providerFilter]);

  /** Client-side category filter helper */
  const filterByCategory = useCallback((items: Product[]) => {
    if (!categoryFilter || categoryFilter === 'all') return items;
    return items.filter(p => isRelevantToCategory(p, categoryFilter));
  }, [categoryFilter]);

  /** Combined filter: provider + category */
  const applyFilters = useCallback((items: Product[]) => {
    return filterByCategory(filterByProvider(items));
  }, [filterByProvider, filterByCategory]);

  // ====== ACCUEIL (trending only) ======
  const fetchAccueilFeed = useCallback(async (forceRefresh = false) => {
    setAccueilLoading(true);
    setError(null);

    // On retry, clear all local caches so we get a truly fresh request
    if (forceRefresh) {
      clearAllCatalogCache();
    }

    const params = {
      page: 1,
      pageSize: 100,
      client: 'web',
    };

    try {
      let data: HomeFeedResponse | null = null;

      try {
        data = await cachedCatalogFetch<HomeFeedResponse>('catalog-home', params, { skipCache: forceRefresh });
      } catch (primaryErr: any) {
        const primaryMessage = String(primaryErr?.message || '');
        const is404 = primaryMessage.includes('404');

        if (!is404) throw primaryErr;

        console.warn('[ShopHome] catalog-home returned 404, retrying compatibility route /catalog/home');
        data = await cachedCatalogFetch<HomeFeedResponse>('catalog/home', params, { skipCache: true });
      }

      if (data?.sections?.length) {
        const all = filterHomepageProducts(
          data.sections.flatMap(s => s.items).map(mapItemToProduct).filter(p => p.id && p.priceUsd > 0)
        );
        setAccueilProducts(all);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load');
    } finally {
      setAccueilLoading(false);
    }
  }, []);

  // Full retry: clears all caches, resets state, re-fetches everything
  const handleFullRetry = useCallback(() => {
    // 1. Clear ALL caches (localStorage + memory)
    clearAllCatalogCache();

    // 2. Reset all state
    setAccueilProducts([]);
    setCategoryItems({});
    setPinnedByCategory({});
    setRecentlyViewed([]);
    setError(null);
    setAccueilLoading(true);

    // 3. Allow refs to re-run
    pinnedFetchedRef.current = false;
    fetchedRef.current = false;

    // 4. Directly call fetchAccueilFeed with forceRefresh
    fetchAccueilFeed(true);
  }, [fetchAccueilFeed]);

  // ====== CURATED CATEGORY HELPERS ======
  const JUNK_TERMS = ['cheap', 'lot', 'bundle', 'broken', 'for repair', 'as is', 'not working'];
  const AUTO_PARTS_JUNK_TERMS = ['for parts', 'parts only', 'not working', 'broken', 'as-is', 'as is', 'read description', 'repair', 'damaged'];
  const isNotJunk = (p: Product) => !JUNK_TERMS.some(t => (p.title || '').toLowerCase().includes(t));
  const isNotAutoPartsJunk = (p: Product) => !AUTO_PARTS_JUNK_TERMS.some(t => (p.title || '').toLowerCase().includes(t));

  const looksLikeVehicle = (title: string) => {
    const t = title.toLowerCase();
    if (/\b(19|20)\d{2}\b/.test(t)) return true;
    if (/\b(miles?|mi|kms?|km)\b/.test(t)) return true;
    if (/\b(suv|sedan|coupe|awd|4wd|rwd|fwd|convertible|hatchback|wagon)\b/.test(t)) return true;
    if (/\b(vin|clean title|salvage|rebuilt)\b/.test(t)) return true;
    return false;
  };

  async function searchValidItems(queries: string[], max: number, seenIds: Set<string>, excludes?: string[]): Promise<Product[]> {
    const results: Product[] = [];
    for (const q of queries) {
      if (results.length >= max) break;
      try {
        const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 10 });
        const searchItems = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct).filter(isNotJunk);
        for (const p of searchItems) {
          if (results.length >= max) break;
          const stableKey = (p.id || '') + '|' + ((p.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40));
          if (seenIds.has(stableKey)) continue;
          if (excludes && excludes.some(ex => (p.title || '').toLowerCase().includes(ex))) continue;
          results.push(p);
          seenIds.add(stableKey);
        }
      } catch (e) { /* continue */ }
    }
    return results;
  }

  async function searchVehicles(queries: string[], max: number, seenIds: Set<string>, excludes: string[]): Promise<Product[]> {
    const results: Product[] = [];
    for (const q of queries) {
      if (results.length >= max) break;
      try {
        const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 15 });
        const raw = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct);
        for (const p of raw) {
          if (results.length >= max) break;
          const title = (p.title || '').toLowerCase();
          const stableKey = (p.id || '') + '|' + title.replace(/[^a-z0-9]/g, '').slice(0, 40);
          if (seenIds.has(stableKey)) continue;
          if (excludes.some(ex => title.includes(ex))) continue;
          if (!looksLikeVehicle(p.title || '')) continue;
          results.push(p);
          seenIds.add(stableKey);
        }
      } catch (e) { /* continue */ }
    }
    return results;
  }

  // ====== PER-CATEGORY INDEPENDENT FETCH ======
  const fetchCategoryItems = useCallback(async (categories: string[], pinnedMap?: Record<string, Product[]>) => {
    const pinned = pinnedMap || pinnedByCategory;
    const tasks = categories.map((catKey) => async () => {
      // Skip dynamic fetch only when pinned items already fill the homepage quota.
      // If price filtering reduced pins below 4, we still need backfill results.
      if ((pinned[catKey]?.length || 0) >= 4) {
        setCategoryLoadingMap(prev => ({ ...prev, [catKey]: false }));
        return;
      }

      setCategoryLoadingMap(prev => ({ ...prev, [catKey]: true }));
      let backgroundRefresh = false;
      if (SLOW_CATEGORIES.has(catKey)) {
        const cached = getCachedCategoryResult(catKey);
        if (cached) {
          const validated = filterForCategory(
            cached.filter(p => p.imageUrl && isRenderableImageUrl(p.imageUrl)),
            catKey
          );
          if (validated.length > 0) {
            setCategoryItems(prev => ({ ...prev, [catKey]: validated }));
            setCategoryLoadingMap(prev => ({ ...prev, [catKey]: false }));
            backgroundRefresh = true;
          }
        }
      }

      try {
        let items: Product[] = [];

        // ===== SPECIAL PATH FOR "clothing" (Mode) =====
        if (catKey === 'clothing') {
          const seenIds = new Set<string>();
          const excludes = getEffectiveExcludes('clothing');
          for (const q of MODE_OVERRIDE_QUERIES) {
            if (items.length >= 4) break;
            try {
              const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 10 });
              const searchItems = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct);
              for (const p of searchItems) {
                if (items.length >= 4) break;
                if (seenIds.has(p.id)) continue;
                const titleLower = (p.title || '').toLowerCase();
                if (excludes.some(ex => titleLower.includes(ex))) continue;
                items.push(p);
                seenIds.add(p.id);
              }
            } catch (e) {
              console.warn(`[Mode] query failed`, e);
            }
          }
          items = sortByLuxury(items).slice(0, 4);

        // ===== SPECIAL PATH FOR "vehicles" =====
        } else if (catKey === 'vehicles') {
          const vehicleExcludes = [
            ...(CATEGORY_EXCLUDE_KEYWORDS['vehicles'] || []),
            'adapter', 'j1772', 'wall connector',
            'floor mat', 'seat cover', 'phone holder', 'mount',
            'keychain', 'sticker', 'decal', 'toy', 'hot wheels',
            'model car', 'diecast', 'scale model', 'matchbox',
          ];
          const isVehicleItem = (p: Product): boolean => {
            if (!p.id || !p.imageUrl) return false;
            if ((p.priceUsd || 0) < 500) return false;
            const t = (p.title || '').toLowerCase();
            if (vehicleExcludes.some(ex => t.includes(ex))) return false;
            return true;
          };
          const seenIds = new Set<string>();

          const EXACT_VEHICLE_QUERIES = [
            '2026 Tesla Model Y Long Range',
            '2025 GMC Yukon XL AT4 Ultimate 4WD Lifted Vossens',
            '2025 Ford Explorer Active AWD SUV',
            '2025 Hyundai Santa Fe XRT Sport Utility',
          ];

          for (const q of EXACT_VEHICLE_QUERIES) {
            if (items.length >= 4) break;
            try {
              const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 5 });
              const searchItems = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct).filter(isVehicleItem);
              for (const p of searchItems) {
                if (items.length >= 4) break;
                const key = p.id + '|' + (p.title || '').slice(0, 30);
                if (seenIds.has(key)) continue;
                seenIds.add(key);
                items.push(p);
                break;
              }
            } catch (e) {
              console.warn(`[Vehicles] exact query failed:`, e);
            }
          }

          if (items.length < 4) {
            const BROAD_VEHICLE_QUERIES = [
              'Tesla Model Y SUV',
              'GMC Yukon SUV',
              'Ford Explorer SUV',
              'Hyundai Santa Fe SUV',
              'Range Rover Sport',
              'BMW X5 SUV',
            ];
            for (const q of BROAD_VEHICLE_QUERIES) {
              if (items.length >= 4) break;
              try {
                const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 10 });
                const searchItems = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct).filter(isVehicleItem);
                for (const p of searchItems) {
                  if (items.length >= 4) break;
                  const key = p.id + '|' + (p.title || '').slice(0, 30);
                  if (seenIds.has(key)) continue;
                  seenIds.add(key);
                  items.push(p);
                  break;
                }
              } catch (e) {
                console.warn(`[Vehicles] broad fallback failed:`, e);
              }
            }
          }

          items = items.slice(0, 4);

        // ===== SPECIAL PATH FOR "electronics" =====
        } else if (catKey === 'electronics') {
          const seenIds = new Set<string>();
          const addUniqueElectronics = (p: Product, bucket: Product[]) => {
            const key = p.id || `${p.title}|${p.productUrl}`;
            if (!key || seenIds.has(key)) return false;
            seenIds.add(key);
            bucket.push(p);
            return true;
          };

          const allElectronics: Product[] = [];
          try {
            const data = await cachedCatalogFetch<any>('catalog-category', {
              category: 'electronics', page: 1, pageSize: 100, client: 'web', language,
            });
            const rawItems = (data?.items || data?.sections?.[0]?.items || [])
              .map(mapSearchItemToProduct)
              .filter(isValidProduct);
            const relevant = filterForCategory(rawItems, 'electronics');
            for (const p of [...relevant, ...rawItems]) {
              if (allElectronics.length >= 8) break;
              addUniqueElectronics(p, allElectronics);
            }
          } catch (e) { console.warn('[Electronics] catalog-category failed:', e); }

          if (allElectronics.length < 4) {
            const queries = CATEGORY_SEARCH_QUERIES.electronics || [];
            for (const q of queries) {
              if (allElectronics.length >= 8) break;
              try {
                const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 12, client: 'web' });
                const raw = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct);
                const relevant = filterForCategory(raw, 'electronics');
                for (const p of [...relevant, ...raw]) {
                  if (allElectronics.length >= 8) break;
                  addUniqueElectronics(p, allElectronics);
                }
              } catch (e) { /* continue */ }
            }
          }

          items = keepEnoughHomepageProducts(deduplicateProducts(sortByLuxury(allElectronics)), catKey).slice(0, 4);

        // ===== SPECIAL PATH FOR "jewelry_watches" =====
        } else if (catKey === 'jewelry_watches') {
          const seenIds = new Set<string>();
          const watchQueries = [
            'Rolex watch', 'Cartier watch', 'Omega watch',
            'Tag Heuer watch', 'Breitling watch', 'Tudor watch',
            'luxury watch men', 'luxury watch women',
          ];
          const watches = await searchValidItems(watchQueries, 4, seenIds);
          const ringQueries = [
            'diamond ring', 'gold ring luxury', 'Cartier ring',
            'Tiffany ring', 'engagement ring diamond',
          ];
          const rings = await searchValidItems(ringQueries, 2, seenIds);
          const fillerQueries = [
            'Cartier bracelet', 'diamond bracelet',
            'luxury necklace', 'diamond necklace',
          ];

          const assembled: Product[] = [];
          for (const w of watches) { if (assembled.length < 2) assembled.push(w); }
          for (const r of rings) { if (assembled.length < 3) assembled.push(r); }
          const leftover = [...watches.slice(2), ...rings.slice(1)];
          for (const p of leftover) { if (assembled.length < 4) assembled.push(p); }
          if (assembled.length < 4) {
            const filler = await searchValidItems(fillerQueries, 4 - assembled.length, seenIds);
            assembled.push(...filler);
          }
          items = assembled.slice(0, 4);
          items.sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0));

        // ===== SPECIAL PATH FOR "parts_accessories" =====
        } else if (catKey === 'parts_accessories') {
          const seenIds = new Set<string>();
          const seenImages = new Set<string>();
          const seenTitleKeys = new Set<string>();

          const addUnique = (p: Product, bucket: Product[]) => {
            const titleKey = (p.title || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 40);
            if (seenIds.has(p.id) || seenTitleKeys.has(titleKey)) return false;
            if (p.imageUrl && seenImages.has(p.imageUrl)) return false;
            seenIds.add(p.id);
            seenTitleKeys.add(titleKey);
            if (p.imageUrl) seenImages.add(p.imageUrl);
            bucket.push(p);
            return true;
          };

          const allParts: Product[] = [];

          // Phase 1: DB-cached items
          try {
            const data = await cachedCatalogFetch<any>('catalog-category', {
              category: 'parts_accessories', limit: 50, page: 1, pageSize: 50, client: 'web',
            });
            const rawItems = (data?.items || []).map((item: any) => ({
              id: item.providerProductId || item.provider_product_id || item.id || '',
              provider: item.provider || 'ebay',
              title: item.title || '',
              imageUrl: item.mainImageUrl || item.imageUrl || item.image_url || '',
              priceUsd: item.priceUsd || item.price_usd || 0,
              rating: item.rating, inStock: true,
              productUrl: item.productUrl || item.product_url || '',
            } as Product)).filter(isValidProduct).filter(isNotAutoPartsJunk);
            for (const p of rawItems) {
              if (allParts.length >= 8) break;
              addUnique(p, allParts);
            }
          } catch (e) { console.warn('[AutoParts] catalog-category failed:', e); }

          // Phase 2: search fallback
          if (allParts.length < 4) {
            const partsQueries = [
              'brake rotor pad set', 'headlight assembly OEM', 'catalytic converter exhaust',
              'car battery AGM', 'alternator replacement', 'strut assembly front',
              'wheel bearing hub', 'fuel pump module', 'power steering rack',
            ];
            for (const q of partsQueries) {
              if (allParts.length >= 8) break;
              try {
                const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 10 });
                const searchItems = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct).filter(isNotAutoPartsJunk);
                for (const p of searchItems) {
                  if (allParts.length >= 8) break;
                  const t = (p.title || '').toLowerCase();
                  const looksAutoPart = ['brake', 'rotor', 'pad', 'headlight', 'alternator', 'battery', 'spark', 'filter', 'wiper', 'bumper', 'bearing', 'belt', 'coil', 'sensor', 'steering', 'pump', 'strut', 'tie rod', 'caliper', 'radiator', 'fuel', 'exhaust', 'muffler', 'axle', 'transmission', 'clutch', 'gasket', 'suspension', 'engine', 'motor', 'turbo', 'injector', 'catalytic', 'car', 'auto', 'vehicle'].some(k => t.includes(k));
                  if (looksAutoPart) addUnique(p, allParts);
                }
              } catch (e) { /* continue */ }
            }
          }

          allParts.sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0));
          items = allParts.slice(0, 4);

        // ===== SPECIAL PATH FOR "cameras_photo" =====
        } else if (catKey === 'cameras_photo') {
          const cameraExcludes = CATEGORY_EXCLUDE_KEYWORDS['cameras_photo'] || [];
          const cameraKeywords = CATEGORY_KEYWORDS['cameras_photo'] || [];
          const seenIds = new Set<string>();

          const isCameraItem = (p: Product): boolean => {
            if (!p.id || !p.imageUrl || !p.priceUsd) return false;
            const t = (p.title || '').toLowerCase();
            if (cameraExcludes.some(ex => t.includes(ex))) return false;
            return cameraKeywords.some(kw => t.includes(kw));
          };

          const addUniqueCamera = (p: Product, bucket: Product[]): boolean => {
            if (seenIds.has(p.id)) return false;
            seenIds.add(p.id);
            bucket.push(p);
            return true;
          };

          const allCameras: Product[] = [];

          try {
            const data = await cachedCatalogFetch<any>('catalog-category', {
              category: 'cameras_photo', limit: 50, page: 1, pageSize: 50, client: 'web',
            });
            const rawItems = (data?.items || []).map((item: any) => ({
              id: item.providerProductId || item.provider_product_id || item.id || '',
              provider: item.provider || 'ebay',
              title: item.title || '',
              imageUrl: item.mainImageUrl || item.imageUrl || item.image_url || '',
              priceUsd: item.priceUsd || item.price_usd || 0,
              rating: item.rating, inStock: true,
              productUrl: item.productUrl || item.product_url || '',
            } as Product)).filter(isCameraItem);
            for (const p of rawItems) {
              if (allCameras.length >= 8) break;
              addUniqueCamera(p, allCameras);
            }
          } catch (e) { console.warn('[Cameras] catalog-category failed:', e); }

          if (allCameras.length < 4) {
            try {
              const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-home', {
                category: 'cameras_photo', page: 1, pageSize: 80, client: 'web',
              });
              const feedItems = (data?.sections?.flatMap(s => s.items) || [])
                .map(mapItemToProduct).filter(isValidProduct).filter(isCameraItem);
              for (const p of feedItems) {
                if (allCameras.length >= 8) break;
                addUniqueCamera(p, allCameras);
              }
            } catch (e) { console.warn('[Cameras] catalog-home failed:', e); }
          }

          if (allCameras.length < 4) {
            const CAMERA_QUERIES = [
              'DSLR camera', 'mirrorless camera Sony Canon Nikon',
              'GoPro action camera', 'camera lens', 'digital camera',
              'camera tripod', 'Nikon camera', 'Fujifilm camera',
            ];
            for (const q of CAMERA_QUERIES) {
              if (allCameras.length >= 8) break;
              try {
                const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 15 });
                const raw = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct).filter(isCameraItem);
                for (const p of raw) {
                  if (allCameras.length >= 8) break;
                  addUniqueCamera(p, allCameras);
                }
              } catch (e) { /* continue */ }
            }
          }

          allCameras.sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0));
          items = allCameras.slice(0, 4);

        } else {
          // ===== STANDARD PATH =====
          try {
            const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-home', {
              category: catKey,
              page: 1,
              pageSize: 80,
              client: 'web',
            });
            const rawItems = (data?.sections?.flatMap(s => s.items) || []).map(mapItemToProduct).filter(isValidProduct);
            items = filterForCategory(rawItems, catKey);
          } catch (e) {
            // Ignore, proceed to search fallback
          }

          if (items.length < 4) {
            const queries = CATEGORY_SEARCH_QUERIES[catKey] || [catKey.replace('_', ' ')];
            for (const q of queries.slice(0, 4)) {
              if (items.length >= 8) break;
              try {
                const data = await cachedCatalogFetch<any>('catalog-search', { q, limit: 8 });
                const searchItems = (data?.items || []).map(mapSearchItemToProduct).filter(isValidProduct);
                items.push(...searchItems);
              } catch (e) {
                // Continue with next query
              }
            }
            items = filterForCategory(items, catKey);
          }

          items = keepEnoughHomepageProducts(deduplicateProducts(sortByLuxury(items)), catKey).slice(0, 4);
        }

        items = keepEnoughHomepageProducts(items, catKey);
        if (items.length < 4) {
          items = await searchCategoryRescue(catKey, items, 4);
        }
        items = keepEnoughHomepageProducts(deduplicateProducts(sortByLuxury(items)), catKey).slice(0, 4);

        if (SLOW_CATEGORIES.has(catKey)) {
          setCachedCategoryResult(catKey, items);
        }

        if (items.length > 0 || !backgroundRefresh) {
          setCategoryItems(prev => ({ ...prev, [catKey]: items }));
        }
      } catch (err) {
        console.warn(`[ShopHome] Category ${catKey} fetch failed:`, err);
        if (!backgroundRefresh) {
          setCategoryItems(prev => ({ ...prev, [catKey]: [] }));
        }
      } finally {
        if (!backgroundRefresh) {
          setCategoryLoadingMap(prev => ({ ...prev, [catKey]: false }));
        }
      }
    });

    await runWithConcurrency(tasks, CONCURRENCY_LIMIT);
  }, [pinnedByCategory]);

  const loadRecentlyViewed = useCallback(async () => {
    try {
      const items = await getRecentlyViewed(user?.id, 12);
      setRecentlyViewed(items);
    } catch (err) {
      console.warn('[ShopHome] recently viewed fetch failed', err);
    }
  }, [user?.id]);

  // ====== TRENDING FEED (memoized) ======
  const trendingFeed = useMemo(() => {
    const dedup = new Set<string>();
    const trendingCats = ALL_HOMEPAGE_CATEGORIES;
    const trending: Product[] = [];

    const categoryPoolProducts: Product[] = [];
    for (const catKey of trendingCats) {
      const pins = filterHomepageProducts(pinnedByCategory[catKey] || [], catKey);
      const fetched = filterHomepageProducts(categoryItems[catKey] || [], catKey);
      categoryPoolProducts.push(...filterForCategory([...pins, ...fetched], catKey));
    }
    const TRENDING_JUNK = ['for parts', 'for repair', 'cracked', 'as-is', 'as is', 'read description', 'broken', 'damaged'];
    const combinedPool = filterHomepageProducts([...categoryPoolProducts, ...accueilProducts]).filter(p => {
      const t = (p.title || '').toLowerCase();
      return !TRENDING_JUNK.some(kw => t.includes(kw));
    });

    for (const cat of trendingCats) {
      if (trending.length >= 16) break;
      const relevant = combinedPool.filter(p => isRelevantToCategory(p, cat));
      const amazonFirst = [
        ...relevant.filter(p => (p.provider || '').toLowerCase() === 'rainforest'),
        ...relevant.filter(p => (p.provider || '').toLowerCase() !== 'rainforest'),
      ];
      const sorted = filterHomepageProducts(sortByLuxury(amazonFirst), cat);
      let count = 0;
      for (const p of sorted) {
        if (count >= 2) break;
        if (!dedup.has(p.id)) {
          trending.push(p);
          dedup.add(p.id);
          count++;
        }
      }
    }

    if (trending.length < 16) {
      for (const p of filterHomepageProducts(sortByLuxury(combinedPool))) {
        if (trending.length >= 16) break;
        if (!dedup.has(p.id) && (p.priceUsd || 0) > 0) {
          trending.push(p);
          dedup.add(p.id);
        }
      }
    }

    const byProvider: Record<string, Product[]> = {};
    for (const p of trending) {
      const prov = (p.provider || 'ebay').toLowerCase();
      const key = prov === 'rainforest' ? 'amazon' : prov;
      if (!byProvider[key]) byProvider[key] = [];
      byProvider[key].push(p);
    }
    const providerQueues = Object.values(byProvider).sort((a, b) => b.length - a.length);
    const interleaved: Product[] = [];
    let qi = 0;
    while (interleaved.length < trending.length) {
      let added = false;
      for (const queue of providerQueues) {
        if (qi < queue.length) {
          interleaved.push(queue[qi]);
          added = true;
        }
      }
      if (!added) break;
      qi++;
    }

    return interleaved.slice(0, 16);
  }, [accueilProducts, categoryItems, pinnedByCategory]);

  // ====== MEMOIZED FILTERED RESULTS ======
  const filteredTrending = useMemo(() => filterHomepageProducts(applyFilters(trendingFeed)), [applyFilters, trendingFeed]);
  const filteredRecentlyViewed = useMemo(() => filterHomepageProducts(applyFilters(recentlyViewed)), [applyFilters, recentlyViewed]);
  const filteredStoreProducts = useMemo(() => filterHomepageProducts(filterByCategory(storeProducts)), [filterByCategory, storeProducts]);
  const homepageFallbackPool = useMemo(() => {
    const pooled = ALL_HOMEPAGE_CATEGORIES.flatMap(catKey => [
      ...(pinnedByCategory[catKey] || []),
      ...(categoryItems[catKey] || []),
    ]);

    return deduplicateProducts(sortByLuxury(filterHomepageProducts([...pooled, ...accueilProducts])));
  }, [accueilProducts, categoryItems, pinnedByCategory]);

  const getHomepageCategoryItems = useCallback((catKey: string) => {
    const pinnedItems = pinnedByCategory[catKey] || [];
    const fetchedItems = categoryItems[catKey] || [];
    const withImages = (arr: Product[]) => arr.filter(p => !!p.imageUrl && isRenderableImageUrl(p.imageUrl));
    const primary = withImages(filterForCategory(deduplicateProducts([...pinnedItems, ...fetchedItems]), catKey));

    if (primary.length >= 4) {
      return applyFilters(keepEnoughHomepageProducts(sortByLuxury(primary), catKey).slice(0, 4));
    }

    const existingIds = new Set(primary.map(product => product.id));
    const fallback = withImages(filterForCategory(
      homepageFallbackPool.filter(product => !existingIds.has(product.id)),
      catKey,
    ));

    const merged = deduplicateProducts(sortByLuxury([...primary, ...fallback]));
    return applyFilters(keepEnoughHomepageProducts(merged, catKey).slice(0, 4));
  }, [applyFilters, pinnedByCategory, categoryItems, homepageFallbackPool]);

  // Memoize per-category display items
  const promoCategoryItems = useMemo(() => {
    return PROMO_CATEGORIES.map(catKey => ({
      catKey,
      items: getHomepageCategoryItems(catKey),
      loading: categoryLoadingMap[catKey] === true,
    }));
  }, [getHomepageCategoryItems, categoryLoadingMap]);

  const remainingCategoryItems = useMemo(() => {
    return ALL_HOMEPAGE_CATEGORIES.filter(k => !PROMO_CATEGORIES.includes(k)).map(catKey => ({
      catKey,
      items: getHomepageCategoryItems(catKey),
      loading: categoryLoadingMap[catKey] === true,
    }));
  }, [getHomepageCategoryItems, categoryLoadingMap]);

  // Phones row (premium phones), then a dedicated Phone Accessories row.
  const PHONE_ACCESSORY_KEYWORDS = [
    'case', 'cover', 'protector', 'tempered glass', 'charger', 'cable',
    'usb-c', 'lightning', 'magsafe', 'airpods', 'earbud', 'earphone',
    'power bank', 'holder', 'mount', 'stand', 'adapter', 'wireless charger',
  ];
  // Bulk phones IS the source of truth for the homepage phone catalog (paginated).
  // We only fall back to curated/pinned items if the bulk fetch hasn't returned yet,
  // so the user never sees an empty grid on first paint.
  const phonesRowItems = useMemo(() => {
    if (bulkPhones.length > 0) {
      // Already filtered/mapped at fetch time; just drop accessories defensively.
      return bulkPhones.filter(p => {
        const tt = (p.title || '').toLowerCase();
        return !PHONE_ACCESSORY_KEYWORDS.some(kw => tt.includes(kw));
      });
    }
    const all = filterForCategory(
      deduplicateProducts([
        ...(pinnedByCategory['phones'] || []),
        ...(categoryItems['phones'] || []),
      ]),
      'phones',
    );
    const handsets = all.filter(p => {
      const tt = (p.title || '').toLowerCase();
      return !PHONE_ACCESSORY_KEYWORDS.some(kw => tt.includes(kw));
    });
    return filterHomepageProducts(sortByLuxury(handsets), 'phones');
  }, [pinnedByCategory, categoryItems, bulkPhones]);

  // Apply user-selected sort on top of the curated phones list.
  // Also drop any product whose primary image AND all gallery fallbacks are
  // ad/banner/promo URLs — these would otherwise render as empty/null cards
  // and create visual gaps that look like "ad slots" on the homepage.
  const sortedPhones = useMemo(() => {
    const cleaned = phonesRowItems.filter((p: any) => {
      const candidates = [p.imageUrl, ...((p.images as string[]) || []), ...((p.imageUrls as string[]) || [])]
        .filter(Boolean);
      return candidates.some((u: string) => isRenderableImageUrl(u));
    });
    const list = [...cleaned];
    if (sortBy === 'cheapest') list.sort((a, b) => (a.priceUsd || 0) - (b.priceUsd || 0));
    else if (sortBy === 'priciest') list.sort((a, b) => (b.priceUsd || 0) - (a.priceUsd || 0));
    return list;
  }, [phonesRowItems, sortBy]);

  const totalPhonePages = Math.max(1, Math.ceil(bulkPhonesTotal / PHONES_PAGE_SIZE));

  const phoneAccessoryItems = useMemo(() => {
    const all = deduplicateProducts([
      ...(pinnedByCategory['phones'] || []),
      ...(categoryItems['phones'] || []),
      ...accueilProducts,
    ]);
    const accessories = all.filter(p => {
      const tt = (p.title || '').toLowerCase();
      return PHONE_ACCESSORY_KEYWORDS.some(kw => tt.includes(kw));
    });
    return filterHomepageProducts(sortByLuxury(accessories), 'phones').slice(0, 12);
  }, [pinnedByCategory, categoryItems, accueilProducts]);

  const [showMoreCategories, setShowMoreCategories] = useState(false);

  // Auto-rescue sparse categories: if displayed < 4 after loading, search-rescue and merge
  const rescueAttemptedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    ALL_HOMEPAGE_CATEGORIES.forEach(async (catKey) => {
      if (categoryLoadingMap[catKey]) return;
      if (rescueAttemptedRef.current.has(catKey)) return;
      const current = getHomepageCategoryItems(catKey);
      if (current.length >= 4) return;
      rescueAttemptedRef.current.add(catKey);
      try {
        const existing = [...(pinnedByCategory[catKey] || []), ...(categoryItems[catKey] || [])];
        const rescued = await searchCategoryRescue(catKey, existing, 4);
        if (rescued.length > 0) {
          setCategoryItems(prev => ({ ...prev, [catKey]: rescued }));
        }
      } catch { /* noop */ }
    });
  }, [categoryLoadingMap, categoryItems, pinnedByCategory, getHomepageCategoryItems]);


  // ====== EFFECTS ======
  const scheduleCategoryPrefetch = useCallback(() => {
    const schedule = typeof requestIdleCallback === 'function'
      ? requestIdleCallback
      : (cb: () => void) => setTimeout(cb, 3000);

    schedule(() => {
      ALL_HOMEPAGE_CATEGORIES.forEach((catKey, i) => {
        setTimeout(() => {
          prefetchCatalogCategory(catKey, language);
        }, i * 500);
      });
    });
  }, [language]);

  // OPTIMIZATION: Parallel initial data fetch — pinned + accueil + providers in parallel
  useEffect(() => {
    if (pinnedFetchedRef.current) return;
    pinnedFetchedRef.current = true;

    (async () => {
      // Phase 1: Fetch pinned items (must resolve first to know which categories need dynamic fetch)
      let grouped: Record<string, Product[]> = {};
      try {
        const { data, error } = await supabase
          .from("homepage_pinned_items")
          .select("*")
          .order("category_key")
          .order("sort_order");
        if (error) throw error;
        const allPinned: Product[] = [];
        for (const item of data || []) {
          const catKey = (item as any).category_key;
          if (!grouped[catKey]) grouped[catKey] = [];
          const product: Product = {
            id: (item as any).provider_product_id || (item as any).catalog_item_id,
            provider: (item as any).provider || 'ebay',
            title: (item as any).title || 'Product',
            imageUrl: (item as any).image_url || '',
            priceUsd: Number((item as any).price_usd) || 0,
            inStock: true,
          };
          grouped[catKey].push(product);
          allPinned.push(product);
        }
        // Resolve all pinned prices server-side in one batch
        await applyServerPrices(allPinned);
        for (const [catKey, products] of Object.entries(grouped)) {
          grouped[catKey] = filterHomepageProducts(products, catKey);
        }
        setPinnedByCategory(grouped);
        const loadingUpdates: Record<string, boolean> = {};
        for (const catKey of ALL_HOMEPAGE_CATEGORIES) {
          if ((grouped[catKey]?.length || 0) >= 4) {
            loadingUpdates[catKey] = false;
          }
        }
        if (Object.keys(loadingUpdates).length > 0) {
          setCategoryLoadingMap(prev => ({ ...prev, ...loadingUpdates }));
        }
      } catch (err) {
        console.warn('[ShopHome] Failed to fetch pinned items:', err);
      }

      // Phase 2: Fire accueil feed + category fetches in parallel
      const catsToFetch = ALL_HOMEPAGE_CATEGORIES.filter(k => (grouped[k]?.length || 0) < 4);

      const accueilPromise = (async () => {
        setAccueilLoading(true);
        setError(null);
        try {
          const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-home', {
            page: 1,
            pageSize: 100,
            client: 'web',
          }, { skipCache: true });
          if (data?.sections?.length) {
            const all = filterHomepageProducts(
              data.sections.flatMap(s => s.items).map(mapItemToProduct).filter(p => p.id && p.priceUsd > 0)
            );
            setAccueilProducts(all);
          }
        } catch (err: any) {
          setError(err.message || 'Failed to load');
        } finally {
          setAccueilLoading(false);
        }
      })();

      const categoryPromise = (async () => {
        if (catsToFetch.length === 0) {
          scheduleCategoryPrefetch();
          return;
        }
        const promos = catsToFetch.filter(k => PROMO_CATEGORIES.includes(k));
        const rest = catsToFetch.filter(k => !PROMO_CATEGORIES.includes(k));

        // Use the grouped pinned data directly (avoids stale closure on pinnedByCategory)
        if (promos.length > 0) {
          await fetchCategoryItems(promos, grouped);
          if (rest.length > 0) {
            await fetchCategoryItems(rest, grouped);
          }
        } else if (rest.length > 0) {
          await fetchCategoryItems(rest, grouped);
        }
        scheduleCategoryPrefetch();
      })();

      const recentPromise = loadRecentlyViewed();

      await Promise.allSettled([accueilPromise, categoryPromise, recentPromise]);
      fetchedRef.current = true;
    })();
  }, [retryCount]);

  // Re-fetch on language change
  useEffect(() => {
    if (!fetchedRef.current) return;
    fetchAccueilFeed(true);
    fetchCategoryItems(ALL_HOMEPAGE_CATEGORIES);
  }, [language]);

  useEffect(() => {
    loadRecentlyViewed();
  }, [user?.id]);

  const isInitialLoading = accueilLoading && Object.values(categoryLoadingMap).every(v => v);

  return (
    <div className="min-h-screen bg-[#0f1115] pb-safe-nav">
      <ShopHeader />
      <div className="pt-16 md:pt-20" />

      {/* 1) Gazelle-style hero + trust bar */}
      <GazelleHero />
      <AvailableInRow />
      <div id="shop-categories-anchor" />

      <main className="pb-8">
        <div className="container mx-auto px-4 sm:px-6 max-w-6xl">
          {/* Filters Toolbar — "Sort by: Featured ▾                                  323 products" */}
          <div className="flex items-center justify-between gap-4 mb-5 pb-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <span className="text-sm text-white/60 font-normal">
                {language === 'fr' ? 'Trier par :' : 'Sort by:'}
              </span>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
                <SelectTrigger className="w-auto min-w-[140px] bg-transparent border-0 text-white font-semibold hover:bg-white/5 rounded-md h-9 px-2 text-sm shadow-none focus:ring-0">
                  <SelectValue placeholder={language === 'fr' ? 'En vedette' : 'Featured'} />
                </SelectTrigger>
                <SelectContent className="bg-black border border-white/20 z-[9999]">
                  <SelectItem value="cheapest" className="text-white hover:bg-white/10 focus:bg-white/10 focus:text-white cursor-pointer">
                    {language === 'fr' ? 'Moins cher d\'abord' : 'Cheapest first'}
                  </SelectItem>
                  <SelectItem value="newest" className="text-white hover:bg-white/10 focus:bg-white/10 focus:text-white cursor-pointer">
                    {language === 'fr' ? 'Nouveautés' : 'Newest'}
                  </SelectItem>
                  <SelectItem value="priciest" className="text-white hover:bg-white/10 focus:bg-white/10 focus:text-white cursor-pointer">
                    {language === 'fr' ? 'Plus cher d\'abord' : 'Priciest first'}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="hidden w-[140px] sm:w-[170px] bg-transparent border border-white/15 text-white/90 hover:bg-white/5 rounded-md h-9 px-3 text-xs sm:text-sm">
                  <SelectValue placeholder={language === 'fr' ? 'Catégorie' : 'Category'} />
                </SelectTrigger>
                <SelectContent className="bg-black border border-white/20 z-[9999]">
                  {CATEGORY_FILTER_OPTIONS.map((opt) => (
                    <SelectItem
                      key={opt.value}
                      value={opt.value}
                      className="text-white hover:bg-white/10 focus:bg-white/10 focus:text-white cursor-pointer"
                    >
                      {language === 'fr' ? opt.labelFr : opt.labelEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={providerFilter} onValueChange={setProviderFilter}>
                <SelectTrigger className="hidden w-[140px] sm:w-[180px] bg-transparent border border-white/15 text-white/90 hover:bg-white/5 rounded-md h-9 px-3 text-xs sm:text-sm">
                  <SelectValue placeholder={language === 'fr' ? 'Boutique' : 'Store'} />
                </SelectTrigger>
                <SelectContent className="bg-black border border-white/20 z-[9999]">
                  <SelectItem
                    value="all"
                    className="text-white hover:bg-white/10 focus:bg-white/10 focus:text-white cursor-pointer"
                  >
                    {language === 'fr' ? 'Tous les magasins' : 'All Stores'}
                  </SelectItem>
                  {dynamicStores.map((opt) => (
                    <SelectItem
                      key={opt.value}
                      value={opt.value}
                      className="text-white hover:bg-white/10 focus:bg-white/10 focus:text-white cursor-pointer"
                    >
                      {opt.label} ({opt.count.toLocaleString()})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <span className="text-sm text-white/60 font-normal whitespace-nowrap">
              {bulkPhonesTotal > 0
                ? `${bulkPhonesTotal.toLocaleString()} ${language === 'fr' ? 'produits' : 'products'}`
                : ''}
            </span>
          </div>

          {providerFilter && providerFilter !== 'all' ? (
            /* ====== STORE-FILTERED FLAT GRID ====== */
            storeProductsLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-white/40" />
              </div>
            ) : storeProducts.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-white/50 text-lg">
                  {language === 'fr'
                    ? `Aucun produit trouvé pour ${providerFilter}`
                    : `No products found for ${providerFilter}`}
                </p>
                <p className="text-white/30 text-sm mt-2">
                  {language === 'fr' ? 'Les produits sont en cours d\'indexation...' : 'Products are being indexed...'}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white/90">
                    {PROVIDER_DISPLAY[providerFilter] || providerFilter.charAt(0).toUpperCase() + providerFilter.slice(1)} — {language === 'fr' ? 'Affichage' : 'Showing'} {filteredStoreProducts.length.toLocaleString()} {language === 'fr' ? 'sur' : 'of'} {storeTotalCount.toLocaleString()} {language === 'fr' ? 'produits' : 'products'}
                  </h2>
                </div>
                <SectionBlock
                  items={filteredStoreProducts}
                  mode="static-grid"
                  maxItems={filteredStoreProducts.length}
                />
                {storeProducts.length < storeTotalCount && (
                  <div className="flex justify-center pt-4">
                    <Button
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      variant="outline"
                      className="border-white/20 text-white/90 hover:bg-white/10 min-w-[200px]"
                    >
                      {loadingMore ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : null}
                      {language === 'fr' ? 'Charger plus' : 'Load More'}
                    </Button>
                  </div>
                )}
              </div>
            )
          ) : categoryFilter && categoryFilter !== 'all' && (!providerFilter || providerFilter === 'all') ? (
            /* ====== CATEGORY-ONLY FLAT GRID ====== */
            categoryProductsLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-white/40" />
              </div>
            ) : categoryProducts.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-white/50 text-lg">
                  {language === 'fr'
                    ? `Aucun produit trouvé pour ${getCategoryTitle(categoryFilter, language)}`
                    : `No products found for ${getCategoryTitle(categoryFilter, language)}`}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-white/90">
                    {getCategoryTitle(categoryFilter, language)} — {language === 'fr' ? 'Affichage' : 'Showing'} {categoryProducts.length.toLocaleString()} {language === 'fr' ? 'sur' : 'of'} {categoryTotalCount.toLocaleString()} {language === 'fr' ? 'produits' : 'products'}
                  </h2>
                </div>
                <SectionBlock
                  items={categoryProducts}
                  mode="static-grid"
                  maxItems={categoryProducts.length}
                />
                {categoryProducts.length < categoryTotalCount && (
                  <div className="flex justify-center pt-4">
                    <Button
                      onClick={handleCategoryLoadMore}
                      disabled={categoryLoadingMore}
                      variant="outline"
                      className="border-white/20 text-white/90 hover:bg-white/10 min-w-[200px]"
                    >
                      {categoryLoadingMore ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : null}
                      {language === 'fr' ? 'Charger plus' : 'Load More'}
                    </Button>
                  </div>
                )}
              </div>
            )
          ) : isInitialLoading ? (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <SectionBlock key={i} items={[]} loading mode="grid" />
                ))}
              </div>
              <SectionBlock items={[]} loading />
            </div>
          ) : error ? (
            <div className="text-center py-20">
              <p className="text-destructive mb-4">{error}</p>
              <Button onClick={handleFullRetry} variant="outline" className="border-white/20 text-white/90 hover:bg-white/10">
                {shop.tryAgain}
              </Button>
            </div>
          ) : (
            <div className="space-y-6" id="phones-grid">
              {bulkPhonesLoading && bulkPhones.length === 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                  {Array.from({ length: 12 }).map((_, i) => (
                    <div key={i} className="aspect-[3/4] rounded-xl bg-white/[0.04] animate-pulse" />
                  ))}
                </div>
              ) : sortedPhones.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 max-w-[1200px] mx-auto">
                    {sortedPhones.map((p, i) => (
                      <PhoneCard key={`${p.id}-${i}`} product={p} />
                    ))}
                  </div>

                  {/* Numeric pagination — Gazelle-style */}
                  {totalPhonePages > 1 && (
                    <PhonePagination
                      currentPage={bulkPhonesPage}
                      totalPages={totalPhonePages}
                      onChange={(p) => setBulkPhonesPage(p)}
                      loading={bulkPhonesLoading}
                    />
                  )}
                </>
              ) : (
                <div className="text-center py-16 text-white/50">
                  {language === 'fr' ? 'Aucun téléphone trouvé.' : 'No phones found.'}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <ShopFooter />
      <BottomNavigation />
    </div>
  );
}

// ===== Numeric pagination — Gazelle-style: « 1 2 3 … N » =====
function PhonePagination({
  currentPage,
  totalPages,
  onChange,
  loading,
}: {
  currentPage: number;
  totalPages: number;
  onChange: (page: number) => void;
  loading?: boolean;
}) {
  const pages: (number | 'ellipsis')[] = [];
  const cur = currentPage;
  const last = totalPages - 1;
  const add = (n: number) => { if (!pages.includes(n)) pages.push(n); };

  add(0);
  if (cur - 2 > 1) pages.push('ellipsis');
  for (let i = Math.max(1, cur - 1); i <= Math.min(last - 1, cur + 1); i++) add(i);
  if (cur + 2 < last - 1) pages.push('ellipsis');
  if (last > 0) add(last);

  const baseBtn = 'min-w-[40px] h-10 px-3 rounded-md text-sm font-medium border border-white/15 text-white/85 hover:bg-white/10 transition disabled:opacity-40 disabled:cursor-not-allowed';
  const activeBtn = 'min-w-[40px] h-10 px-3 rounded-md text-sm font-semibold bg-white text-blue-700 border border-white shadow-sm';

  return (
    <nav className="flex items-center justify-center gap-2 pt-6 flex-wrap" aria-label="Pagination">
      <button
        onClick={() => onChange(Math.max(0, cur - 1))}
        disabled={loading || cur === 0}
        className={baseBtn}
        aria-label="Previous page"
      >
        ‹
      </button>
      {pages.map((p, i) =>
        p === 'ellipsis' ? (
          <span key={`e-${i}`} className="px-2 text-white/40 select-none">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p)}
            disabled={loading}
            className={p === cur ? activeBtn : baseBtn}
            aria-current={p === cur ? 'page' : undefined}
          >
            {p + 1}
          </button>
        )
      )}
      <button
        onClick={() => onChange(Math.min(last, cur + 1))}
        disabled={loading || cur >= last}
        className={baseBtn}
        aria-label="Next page"
      >
        ›
      </button>
    </nav>
  );
}
