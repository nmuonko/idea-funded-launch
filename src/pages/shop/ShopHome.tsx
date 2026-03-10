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
import { ShopFooter } from '@/components/shop/ShopFooter';
import { HorizontalProductRow } from '@/components/shop/HorizontalProductRow';
import { Product } from '@/components/shop/ProductCard';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cachedCatalogFetch } from '@/lib/catalogCache';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { translations } from '@/lib/i18n/translations';
import { getRecentlyViewed } from '@/lib/recentlyViewed';
import { isRenderableImageUrl } from '@/lib/imageValidation';
import { supabase } from '@/integrations/supabase/client';

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

function getCachedCategoryResult(catKey: string): Product[] | null {
  try {
    const raw = localStorage.getItem(`afrishop_curated_v2:${catKey}`);
    if (!raw) return null;
    const { items, ts } = JSON.parse(raw);
    if (Date.now() - ts > CURATED_CACHE_TTL_MS) return null;
    if (!Array.isArray(items) || items.length === 0) return null;
    return items;
  } catch { return null; }
}

function setCachedCategoryResult(catKey: string, items: Product[]) {
  try {
    if (items.length > 0) {
      localStorage.setItem(`afrishop_curated_v2:${catKey}`, JSON.stringify({ items, ts: Date.now() }));
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

const isValidProduct = (p: Product) => p.id && p.priceUsd > 0 && (p.imageUrl ? isRenderableImageUrl(p.imageUrl) : true);

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
  const fetchedRef = useRef(false);
  const [dynamicStores, setDynamicStores] = useState<{ value: string; label: string; count: number }[]>([]);

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

  // Fetch distinct providers via RPC for dynamic store dropdown
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
            priceUsd: item.price_usd || 0,
            rating: item.rating,
            inStock: item.in_stock !== false,
            productUrl: item.product_url,
          };
        })
        .filter((p): p is Product => p !== null);

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

        mapped = deduplicateProducts(sortByLuxury(fallbackPool)).slice(0, PAGE_SIZE);
        if (totalCount === 0) totalCount = mapped.length;
      }

      if (append) {
        setCategoryProducts(prev => {
          const combined = deduplicateProducts([...prev, ...mapped]);
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

    try {
      const data = await cachedCatalogFetch<HomeFeedResponse>('catalog-home', {
        page: 1,
        pageSize: 100,
        client: 'web',
      }, { skipCache: forceRefresh });
      if (data?.sections?.length) {
        const all = data.sections.flatMap(s => s.items).map(mapItemToProduct).filter(p => p.id && p.priceUsd > 0);
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
      // OPTIMIZATION: Skip fetch entirely if pinned items exist for this category
      if (pinned[catKey]?.length > 0) {
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

          items = deduplicateProducts(sortByLuxury(items)).slice(0, 4);
        }

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
    const trendingCats = ['phones', 'cameras_photo', 'vehicles', 'clothing', 'electronics', 'jewelry_watches', 'gaming', 'audio_music', 'home_garden', 'sporting_goods', 'toys', 'parts_accessories', 'refurbished'];
    const trending: Product[] = [];

    const allPinnedProducts: Product[] = [];
    for (const catKey of trendingCats) {
      const pins = pinnedByCategory[catKey] || [];
      allPinnedProducts.push(...pins);
    }
    const combinedPool = [...allPinnedProducts, ...accueilProducts];

    for (const cat of trendingCats) {
      if (trending.length >= 16) break; // Early termination
      const relevant = combinedPool.filter(p => isRelevantToCategory(p, cat));
      const amazonFirst = [
        ...relevant.filter(p => (p.provider || '').toLowerCase() === 'rainforest'),
        ...relevant.filter(p => (p.provider || '').toLowerCase() !== 'rainforest'),
      ];
      const sorted = sortByLuxury(amazonFirst);
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
      for (const p of sortByLuxury(combinedPool)) {
        if (trending.length >= 16) break;
        if (!dedup.has(p.id) && (p.priceUsd || 0) > 0) {
          trending.push(p);
          dedup.add(p.id);
        }
      }
    }

    // Provider diversity interleave
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
  }, [accueilProducts, pinnedByCategory]);

  // ====== MEMOIZED FILTERED RESULTS ======
  const filteredTrending = useMemo(() => applyFilters(trendingFeed), [applyFilters, trendingFeed]);
  const filteredRecentlyViewed = useMemo(() => applyFilters(recentlyViewed), [applyFilters, recentlyViewed]);
  const filteredStoreProducts = useMemo(() => filterByCategory(storeProducts), [filterByCategory, storeProducts]);

  // Memoize per-category display items
  const promoCategoryItems = useMemo(() => {
    return PROMO_CATEGORIES.map(catKey => ({
      catKey,
      items: applyFilters(pinnedByCategory[catKey]?.length ? pinnedByCategory[catKey] : (categoryItems[catKey] ?? [])),
      loading: categoryLoadingMap[catKey] === true,
    }));
  }, [applyFilters, pinnedByCategory, categoryItems, categoryLoadingMap]);

  const remainingCategoryItems = useMemo(() => {
    return ALL_HOMEPAGE_CATEGORIES.filter(k => !PROMO_CATEGORIES.includes(k)).map(catKey => ({
      catKey,
      items: applyFilters(pinnedByCategory[catKey]?.length ? pinnedByCategory[catKey] : (categoryItems[catKey] ?? [])),
      loading: categoryLoadingMap[catKey] === true,
    }));
  }, [applyFilters, pinnedByCategory, categoryItems, categoryLoadingMap]);

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
        for (const item of data || []) {
          const catKey = (item as any).category_key;
          if (!grouped[catKey]) grouped[catKey] = [];
          grouped[catKey].push({
            id: (item as any).provider_product_id || (item as any).catalog_item_id,
            provider: (item as any).provider || 'ebay',
            title: (item as any).title || 'Product',
            imageUrl: (item as any).image_url || '',
            priceUsd: Number((item as any).price_usd) || 0,
            inStock: true,
          });
        }
        setPinnedByCategory(grouped);
        const loadingUpdates: Record<string, boolean> = {};
        for (const catKey of ALL_HOMEPAGE_CATEGORIES) {
          if (grouped[catKey]?.length > 0) {
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
      const catsToFetch = ALL_HOMEPAGE_CATEGORIES.filter(k => !(grouped[k]?.length > 0));

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
            const all = data.sections.flatMap(s => s.items).map(mapItemToProduct).filter(p => p.id && p.priceUsd > 0);
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
    <div className="min-h-screen bg-[#0f1115] pb-20 md:pb-0">
      <ShopHeader />
      <div className="pt-16 md:pt-20" />

      {/* 1) Hero Banner Carousel */}
      <section className="mb-5">
        <HeroBannerCarousel />
      </section>

      <main className="pb-8">
        <div className="container mx-auto px-3 sm:px-4">
          {/* Filters Row */}
          <div className="grid grid-cols-2 sm:flex sm:justify-end gap-2 mb-4">
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-full sm:w-[180px] bg-white/10 border border-white/20 text-white rounded-full h-11 px-4 text-sm">
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
              <SelectTrigger className="w-full sm:w-[190px] bg-white/10 border border-white/20 text-white rounded-full h-11 px-4 text-sm">
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
            <div className="space-y-6">

              {/* Paste-Link CTA Banner */}
              <Link
                to="/paste-link"
                className="group relative block overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent p-4 sm:p-5 transition-all hover:border-primary/50 hover:shadow-[0_0_30px_-5px_hsl(var(--primary)/0.3)]"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative space-y-3 sm:space-y-3.5">
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div className="flex-shrink-0 flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-primary/20 border border-primary/30 group-hover:bg-primary/30 transition-colors">
                      <Link2 className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-1">
                        <p className="text-sm sm:text-lg font-bold text-white leading-tight">
                          {language === 'fr' ? "Collez le lien. On calcule le prix." : "Paste the link. We get the price."}
                        </p>
                      </div>
                      <p className="text-xs sm:text-sm text-white/65 leading-snug">
                        {language === 'fr' ? "Introuvable en catalogue ? Collez le lien du produit." : "Can't find it in catalog? Paste the product link."}
                      </p>
                    </div>

                    <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5 text-primary flex-shrink-0 mt-1 group-hover:translate-x-1 transition-transform" />
                  </div>

                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    <div className="h-10 sm:h-11 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center">
                      <img src="/images/logos/amazon.svg" alt="Amazon" className="h-4 sm:h-5 w-auto max-w-[72px] sm:max-w-[95px] object-contain opacity-90" />
                    </div>
                    <div className="h-10 sm:h-11 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center">
                      <img src="/images/logos/shein-white.svg" alt="SHEIN" className="h-3.5 sm:h-4.5 w-auto object-contain opacity-90" />
                    </div>
                    <div className="h-10 sm:h-11 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center">
                      <img src="/images/logos/tesla-official.png" alt="Tesla" className="h-5 sm:h-6 w-auto object-contain opacity-90" />
                    </div>
                  </div>
                </div>
              </Link>

              {/* 2) Trending Grid */}
              {filteredTrending.length > 0 && (
                <SectionBlock
                  title={language === 'fr' ? 'Tendances' : 'Trending Now'}
                  items={filteredTrending}
                  mode="static-grid"
                  seeAllLink="/category/all"
                />
              )}

              {/* 3) Promo Tiles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {promoCategoryItems.map(({ catKey, items, loading }) => (
                  <SectionBlock
                    key={catKey}
                    title={getCategoryTitle(catKey, language)}
                    items={items}
                    loading={loading}
                    mode="grid"
                    categoryKey={catKey}
                  />
                ))}
              </div>

              {/* 4) Recently Viewed */}
              {filteredRecentlyViewed.length > 0 && (
                <LazySection minHeight={180}>
                  <div className="bg-[#1a1d23] border border-white/[0.08] rounded-2xl p-3 sm:p-4 shadow-md">
                    <div className="flex items-center gap-2 mb-3 px-1">
                      <Clock className="h-4 w-4 text-white/60" />
                      <h2 className="text-lg font-semibold text-white/90">
                        {language === 'fr' ? 'Vus récemment' : 'Recently Viewed'}
                      </h2>
                    </div>
                    <HorizontalProductRow products={filteredRecentlyViewed} />
                  </div>
                </LazySection>
              )}

              {/* 5) Remaining Category Grid Cards */}
              <LazySection minHeight={600}>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {remainingCategoryItems.map(({ catKey, items, loading }) => (
                    <SectionBlock
                      key={catKey}
                      title={getCategoryTitle(catKey, language)}
                      items={items}
                      loading={loading}
                      mode="grid"
                      categoryKey={catKey}
                    />
                  ))}
                </div>
              </LazySection>

              {/* 6) Category Icons Row */}
              <LazySection minHeight={80}>
                <CategoryIconsRow />
              </LazySection>
            </div>
          )}
        </div>
      </main>

      <ShopFooter />
      <BottomNavigation />
    </div>
  );
}
