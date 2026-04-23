const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, X, RefreshCw, AlertCircle, Link2, ArrowRight } from 'lucide-react';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { CategoryTabs } from '@/components/shop/CategoryTabs';
import { ProductGrid } from '@/components/shop/ProductGrid';
import { Product } from '@/components/shop/ProductCard';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { normalizeQuery, stableStringify, cachedCatalogFetchWithSwr, cachedCatalogFetch, generateCacheKey, getCached } from '@/lib/catalogCache';
import { collectProductImageCandidates, pickBestImage } from '@/lib/imageValidation';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';
const PAGE_SIZE = 500;
const HARD_MAX_ITEMS = 2000;
const MAX_PAGES = Math.ceil(HARD_MAX_ITEMS / PAGE_SIZE); // 4

/** Generate a unique key per product for deduplication — provider-aware */
function productKey(p: Product): string {
  const provider = p.provider || 'unknown';
  const pid = (p as any).providerProductId || p.id || '';
  if (pid) return `${provider}:${pid}`;
  if (p.productUrl) {
    try {
      const u = new URL(p.productUrl);
      return `${provider}:${u.hostname}${u.pathname}`;
    } catch { /* fall through */ }
  }
  return `${provider}:${p.title || ''}`;
}

/** Deduplicate products using a Set of seen keys */
function dedupeWithSet(list: Product[], seenIds: Set<string>): Product[] {
  return list.filter(p => {
    const key = productKey(p);
    if (seenIds.has(key)) return false;
    seenIds.add(key);
    return true;
  });
}

/** Map raw API items to Product interface, filtering out bad images */
function mapItems(items: any[]): Product[] {
  return items.map((item: any) => {
    const candidates = collectProductImageCandidates(
      item.image_url,
      item.imageUrl,
      item.mainImageUrl,
      item.image,
      item.images,
      item.imageUrls,
    );
    const imageUrl = pickBestImage(candidates);
    return {
      id: item.provider_product_id || item.id,
      provider: item.provider || 'amazon',
      title: item.title || 'Product',
      imageUrl: imageUrl === '/placeholder.svg' ? '' : imageUrl,
      images: candidates,
      imageUrls: candidates,
      priceUsd: item.price_usd || item.priceUsd || 0,
      rating: item.rating,
      inStock: item.in_stock !== false,
      productUrl: item.product_url,
    };
  });
}

export default function SearchResults() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = searchParams.get('q') || '';
  const category = searchParams.get('category') || '';
  const initialSort = searchParams.get('sort') || 'price_asc';
  const initialProvider = searchParams.get('provider') || 'all';
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = (t.shop || {}) as any;

  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState(initialSort);
  const [providerFilter, setProviderFilter] = useState(initialProvider);
  const [maxPrice, setMaxPrice] = useState(500000);
  const maxPriceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [incomplete, setIncomplete] = useState(false);
  const [prefetchingNext, setPrefetchingNext] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorMode, setCursorMode] = useState(false);
  const [providersStatus, setProvidersStatus] = useState<any>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeSearchTokenRef = useRef(0);
  const revalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef(0);
  const lastRequestedPageRef = useRef<number | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ===== AI search intent (USA→China→… by default; fashion → China + Turkey only) =====
  type SearchIntent = {
    category: string;
    is_fashion: boolean;
    country_priority: string[];
    provider_priority: string[];
  };
  const [intent, setIntent] = useState<SearchIntent | null>(null);
  useEffect(() => {
    if (!query?.trim()) { setIntent(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/search-intent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
          body: JSON.stringify({ q: query }),
        });
        if (!r.ok) return;
        const data = (await r.json()) as SearchIntent;
        if (!cancelled) setIntent(data);
      } catch { /* silent — fallback to default routing */ }
    })();
    return () => { cancelled = true; };
  }, [query]);

  // Auto-redirect fashion queries straight to the China (or Turkey) product grid.
  // Fashion intent has country_priority = ['china','turkey'] only.
  useEffect(() => {
    if (!intent?.is_fashion) return;
    const target = (intent.country_priority?.[0] || 'china').toLowerCase();
    const route = target === 'turkey' ? '/shop/turkey' : '/shop/china';
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    navigate(`${route}${qs}`, { replace: true });
  }, [intent, navigate, query]);

  // Derived: client-side provider filtering for instant results
  const products = useMemo(() => {
    if (!providerFilter || providerFilter === 'all') return allProducts;
    const filterKey = providerFilter === 'amazon' ? 'rainforest' : providerFilter;
    return allProducts.filter(p => {
      const prov = (p.provider || '').toLowerCase();
      return prov === filterKey || prov === providerFilter;
    });
  }, [allProducts, providerFilter]);

  const SORT_OPTIONS = [
    { value: 'price_asc', label: shop.priceLowToHigh || 'Price: Low to High' },
    { value: 'relevance', label: shop.relevance || 'Relevance' },
    { value: 'price_desc', label: shop.priceHighToLow || 'Price: High to Low' },
    { value: 'rating', label: shop.topRated || 'Top Rated' },
  ];

  const PROVIDER_OPTIONS = [
    { value: 'all', label: language === 'fr' ? 'Tous' : 'All' },
    { value: 'amazon', label: 'Amazon' },
    { value: 'ebay', label: 'eBay' },
    { value: 'shein', label: 'SHEIN' },
    { value: 'cargurus', label: 'CarGurus' },
    { value: 'carvana', label: 'Carvana' },
  ];

  const DEFAULT_CATEGORY_QUERIES: Record<string, string> = {
    gaming: 'video game console',
    electronics: 'iphone',
    vehicles: 'used car',
    home: 'living room sofa set dining table set kitchen cabinet',
    fashion: 'shoes clothing',
    toys: 'lego toys',
    sporting_goods: 'fitness equipment',
    watches: 'watch jewelry',
    refurbished: 'refurbished phone laptop',
  };

  /** Build params object for cachedCatalogFetchWithSwr */
  const buildSearchParams = useCallback((pageNum: number, cursor?: string | null, queryOverride?: string): Record<string, string> => {
    const IGNORED_CATEGORIES = new Set(['', 'all', 'home', 'accueil']);
    const effectiveCategory = IGNORED_CATEGORIES.has(category.toLowerCase()) ? '' : category;
    const searchQuery = queryOverride || query || DEFAULT_CATEGORY_QUERIES[effectiveCategory] || effectiveCategory.replace(/_/g, ' ') || 'popular';
    
    const params: Record<string, string> = {
      q: searchQuery.trim(),
      limit: String(PAGE_SIZE),
      page: String(pageNum),
    };

    if (cursor) {
      params.cursor = cursor;
    }

    if (effectiveCategory) {
      params.category_key = effectiveCategory;
    }
    if (sort && sort !== 'relevance') params.sort = sort;

    const filters: Record<string, number> = {};
    if (maxPrice < 500000) filters.maxPrice = maxPrice;
    if (Object.keys(filters).length > 0) {
      params.filters = stableStringify(filters);
    }

    return params;
  }, [query, category, sort, maxPrice]);

  const searchIdentityRef = useRef('');

  // Client-side broadening removed — server-side catalog-search handles all broadening
  // for unified web + mobile parity.

  const fetchProducts = useCallback(async (pageNum: number, append: boolean = false, cursorVal?: string | null): Promise<{ returnedCount: number; backendHasMore: boolean; incomplete: boolean } | null> => {
    if (pageNum === 0 && abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    if (pageNum === 0) {
      abortControllerRef.current = controller;
    }

    const currentIdentity = `${query}|${category}|${sort}`;
    let token: number | null = null;

    // Full reset on new search
    if (pageNum === 0 && !append) {
      activeSearchTokenRef.current += 1;
      token = activeSearchTokenRef.current;
      seenIdsRef.current = new Set();
      searchIdentityRef.current = currentIdentity;
      retryCountRef.current = 0;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      pageRef.current = 0;
      if (revalidateTimerRef.current) {
        clearTimeout(revalidateTimerRef.current);
        revalidateTimerRef.current = null;
      }
      setLoading(true);
      setHasSearched(false);
      setHasMore(true);
      setAllProducts([]);
      setIncomplete(false);
      setSearchError(null);
      setIsRevalidating(false);
      setPrefetchingNext(false);
      setNextCursor(null);
      setCursorMode(false);
      
    } else if (pageNum > 0) {
      setLoadingMore(true);
    }

    const effectiveCursor = cursorVal || null;

    console.log('[SEARCH_REQ]', { page: pageNum, cursor: effectiveCursor, limit: PAGE_SIZE, q: query, category, sort });

    try {
      const params = buildSearchParams(pageNum, effectiveCursor);
      
      let data: any;
      let fromCache = false;
      
      if (pageNum === 0 && !append) {
        const swrResult = await cachedCatalogFetchWithSwr<any>('catalog-search', params, {
          signal: controller.signal,
          onUpdate: (freshData) => {
            if (token !== null && token !== activeSearchTokenRef.current) return;
            const mappedFresh = mapItems(freshData?.items || []);
            const freshDeduped = dedupeWithSet(mappedFresh, new Set(seenIdsRef.current));
            if (freshDeduped.length > 0) {
              seenIdsRef.current = new Set();
              const allFresh = dedupeWithSet(mapItems(freshData?.items || []), seenIdsRef.current);
              setAllProducts(allFresh);
            }
            const bHasMore = freshData?.hasMore === true;
            const bIncomplete = !!freshData?.incomplete || !!freshData?.partial;
            setHasMore(bHasMore || bIncomplete);
            setIncomplete(bIncomplete);
            setIsRevalidating(false);
          },
        });
        data = swrResult.data;
        fromCache = swrResult.fromCache;
        if (swrResult.isStale) {
          setIsRevalidating(true);
        }
      } else {
        const url = new URL(`${SUPABASE_URL}/functions/v1/catalog-search`);
        Object.entries(params).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== '') {
            url.searchParams.set(key, String(value));
          }
        });
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          signal: controller.signal,
        });

        if (controller.signal.aborted) return null;
        if (token !== null && token !== activeSearchTokenRef.current) return null;

        if (!response.ok) {
          const errText = await response.text();
          console.error('[SEARCH_ERROR] status:', response.status, 'body:', errText);
          throw new Error(`Search failed: ${response.status}`);
        }

        data = await response.json();
      }

      if (controller.signal.aborted) return null;
      if (token !== null && token !== activeSearchTokenRef.current) return null;

      const returnedCount = data?.items?.length || 0;
      const isIncomplete = !!data?.incomplete || !!data?.partial;
      const backendHasMore = data?.hasMore === true;

      const responseCursor = data?.cursor || data?.nextCursor || data?.cursorNext || data?.meta?.cursor || data?.meta?.nextCursor || null;

      console.log('[SEARCH_RES]', { page: pageNum, got: returnedCount, hasMore: backendHasMore, incomplete: isIncomplete, nextCursor: responseCursor, fromCache, totalFromBackend: data?.total });

      // Auto-retry when backend signals rate-limited empty results
      if (data?.retryable && returnedCount === 0 && pageNum === 0 && retryCountRef.current < 2) {
        retryCountRef.current += 1;
        const delay = data.retryAfterMs || 3000;
        console.log(`[SEARCH_RETRY] Rate-limited empty results, auto-retrying in ${delay}ms (attempt ${retryCountRef.current}/2)`);
        // Keep loading state active during retry
        retryTimerRef.current = setTimeout(() => {
          if (token !== null && token !== activeSearchTokenRef.current) return;
          fetchProducts(0, false);
        }, delay);
        return null; // Don't update UI yet
      }

      if (data?.providersStatus) {
        setProvidersStatus(data.providersStatus);
      }

      if (responseCursor) {
        setCursorMode(true);
        setNextCursor(responseCursor);
      } else {
        setNextCursor(null);
      }

      const mappedProducts = mapItems(data?.items || []);

      if (append) {
        const newUnique = dedupeWithSet(mappedProducts, seenIdsRef.current);
        setAllProducts(prev => [...prev, ...newUnique]);
      } else {
        seenIdsRef.current = new Set();
        const deduped = dedupeWithSet(mappedProducts, seenIdsRef.current);

        // DO NOT re-sort primary backend results — backend already returns
        // items in proper relevance order using the TRANSLATED English query.
        // Client-side re-sorting with original French tokens corrupts the order
        // (e.g., "ordinateur" tokens don't match English "laptop" titles).

        setAllProducts(deduped);
      }

      const reachedCap = pageNum >= MAX_PAGES - 1;
      const computedHasMore = !reachedCap && (backendHasMore || isIncomplete || !!responseCursor || returnedCount === PAGE_SIZE);
      setHasMore(computedHasMore);
      setIncomplete(isIncomplete);

      console.log('[SEARCH_PAGINATION]', { pageNum, computedHasMore, backendHasMore, isIncomplete, hasCursor: !!responseCursor, returnedCount, maxPages: MAX_PAGES });

      // Auto-revalidate page 0 if incomplete
      if (pageNum === 0 && isIncomplete && !append && !fromCache) {
        const capturedToken = token ?? activeSearchTokenRef.current;
        revalidateTimerRef.current = setTimeout(() => {
          if (capturedToken !== activeSearchTokenRef.current) return;
          revalidateInBackground(capturedToken);
        }, 500);
      }

      // Force a fresh revalidation when page-0 comes from cache for typed search queries.
      // This prevents stale/misclassified cached results (e.g. old "ordinateur" cache) from sticking.
      if (pageNum === 0 && !append && fromCache && query.trim().length >= 2) {
        const capturedToken = token ?? activeSearchTokenRef.current;
        revalidateTimerRef.current = setTimeout(() => {
          if (capturedToken !== activeSearchTokenRef.current) return;
          revalidateInBackground(capturedToken);
        }, 100);
      }

      const fetchResult = { returnedCount, backendHasMore, incomplete: isIncomplete };
      
      if (!controller.signal.aborted) {
        if (token === null || token === activeSearchTokenRef.current) {
          setLoading(false);
          setHasSearched(true);
        }
        setLoadingMore(false);
      }

      // Broadening is now handled server-side in catalog-search for web+mobile parity.
      
      return fetchResult;
    } catch (err: any) {
      if (err.name === 'AbortError') return null;
      if (token !== null && token !== activeSearchTokenRef.current) return null;
      console.error('Search error:', err);
      setSearchError(err.message || 'Search failed');
      setHasSearched(true);
      
      if (!controller.signal.aborted) {
        if (token === null || token === activeSearchTokenRef.current) {
          setLoading(false);
          setHasSearched(true);
        }
        setLoadingMore(false);
      }
      
      return null;
    }
  }, [buildSearchParams, query, category, sort]);

  /** Background revalidation to enrich incomplete page-0 results */
  const revalidateInBackground = useCallback(async (token: number) => {
    if (token !== activeSearchTokenRef.current) return;
    setIsRevalidating(true);
    setPrefetchingNext(true);
    try {
      const params = buildSearchParams(0);
      const data = await cachedCatalogFetch<any>('catalog-search', params, { skipCache: true });
      if (token !== activeSearchTokenRef.current) return;

      // Page-0 revalidation: merge fresh results with existing (preserving broadened items).
      // Only replace if fresh data is substantially better (more items) to prevent flickering.
      const freshMapped = mapItems(data?.items || []);
      setAllProducts(prev => {
        // If fresh data has more or equal items, use it as the base
        if (freshMapped.length >= prev.length) {
          const freshSeenIds = new Set<string>();
          const freshDeduped = dedupeWithSet(freshMapped, freshSeenIds);
          seenIdsRef.current = freshSeenIds;
          return freshDeduped;
        }
        // Otherwise merge: keep existing, add any new fresh items
        const mergedSeenIds = new Set<string>();
        const existing = dedupeWithSet([...prev], mergedSeenIds);
        const newFromFresh = dedupeWithSet(freshMapped, mergedSeenIds);
        seenIdsRef.current = mergedSeenIds;
        return [...existing, ...newFromFresh];
      });

      if (token === activeSearchTokenRef.current) {
        const backendHasMore = data?.hasMore === true;
        const isIncomplete = !!data?.incomplete || !!data?.partial;
        setHasMore(backendHasMore || isIncomplete);
        setIncomplete(isIncomplete);
      }

      if (token === activeSearchTokenRef.current) {
        const backendHasMore = data?.hasMore === true;
        const isIncomplete = !!data?.incomplete || !!data?.partial;
        setHasMore(backendHasMore || isIncomplete);
        setIncomplete(isIncomplete);
      }
    } catch {
      // Revalidation failed silently
    } finally {
      if (token === activeSearchTokenRef.current) {
        setIsRevalidating(false);
        setPrefetchingNext(false);
      }
    }
  }, [buildSearchParams]);

  // Initial search
  useEffect(() => {
    setPage(0);
    pageRef.current = 0;
    lastRequestedPageRef.current = null;
    fetchProducts(0, false);
  }, [query, category, sort]);

  const handleSearch = (newQuery: string) => {
    setSearchParams({ q: newQuery, sort });
  };

  const handleSortChange = (newSort: string) => {
    setSort(newSort);
    setSearchParams((prev) => {
      prev.set('sort', newSort);
      return prev;
    });
  };

  // Use refs for handleLoadMore to avoid stale closures
  const loadingRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);
  const nextCursorRef = useRef<string | null>(null);
  const cursorModeRef = useRef(false);

  // Keep refs in sync
  useEffect(() => { loadingRef.current = loading; }, [loading]);
  useEffect(() => { loadingMoreRef.current = loadingMore; }, [loadingMore]);
  useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
  useEffect(() => { nextCursorRef.current = nextCursor; }, [nextCursor]);
  useEffect(() => { cursorModeRef.current = cursorMode; }, [cursorMode]);

  const handleLoadMore = useCallback(() => {
    if (loadingRef.current || loadingMoreRef.current) return;
    if (!hasMoreRef.current) return;

    const nextPage = pageRef.current + 1;
    if (nextPage >= MAX_PAGES) {
      console.log('[LOADMORE_SKIP] MAX_PAGES reached', { nextPage, MAX_PAGES });
      return;
    }
    if (lastRequestedPageRef.current === nextPage) return;
    lastRequestedPageRef.current = nextPage;

    pageRef.current = nextPage;
    setPage(nextPage);
    const cursorToUse = cursorModeRef.current ? nextCursorRef.current : null;
    console.log('[LOADMORE]', { nextPage, cursorMode: cursorModeRef.current, cursor: cursorToUse });
    fetchProducts(nextPage, true, cursorToUse);
  }, [fetchProducts]);

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);
  const sentinelVisibleRef = useRef(false);

  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        sentinelVisibleRef.current = entry.isIntersecting;
        if (!entry.isIntersecting) return;
        handleLoadMore();
      },
      { rootMargin: '1200px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [handleLoadMore]);

  // Re-check: after loading finishes, if sentinel is still visible, load more
  useEffect(() => {
    if (!loading && !loadingMore && hasMore && sentinelVisibleRef.current) {
      const t = setTimeout(() => {
        if (!loadingRef.current && !loadingMoreRef.current && hasMoreRef.current && sentinelVisibleRef.current) {
          console.log('[SENTINEL_RECHECK] Triggering load more');
          handleLoadMore();
        }
      }, 150);
      return () => clearTimeout(t);
    }
  }, [loading, loadingMore, hasMore, handleLoadMore]);


  const handleApplyFilters = () => {
    setPage(0);
    fetchProducts(0, false);
  };

  // Derived: only show empty state when truly done
  const showEmpty = hasSearched && !loading && !loadingMore && !prefetchingNext && !isRevalidating && !incomplete && products.length === 0;

  return (
    <div className="min-h-screen bg-black pb-safe-nav">
      <ShopHeader />

      {/* Category Tabs */}
      <div className="pt-16 md:pt-20 pb-4 px-3 md:px-4 border-b border-white/10 bg-black/50 backdrop-blur-xl sticky top-14 md:top-16 z-40">
        <div className="container mx-auto">
          <CategoryTabs 
            activeCategory={category || 'all'} 
            onCategoryChange={(cat) => {
              if (cat === 'all') {
                navigate('/');
                return;
              } else {
                setSearchParams({ q: query, category: cat, sort });
              }
            }}
          />
        </div>
      </div>

      {/* Results Area */}
      <main className="px-4 py-6">
        <div className="container mx-auto">
          {/* Results Header */}
          <div className="flex flex-col items-start gap-3 mb-6 mt-2 overflow-visible">
            <div className="min-w-0 shrink">
              {query && (
                <h1 className="text-lg md:text-xl font-bold text-white whitespace-normal break-words leading-snug">
                  {shop.resultsFor || 'Results for'} "{query}"
                </h1>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                {!loading && hasSearched && (
                  <p className="text-sm text-white/60 whitespace-normal break-words leading-snug">
                    {products.length} {language === 'fr' ? 'produits affichés' : 'products shown'}
                    {(hasMore || incomplete) && (
                      <span className="ml-2 text-xs text-white/40">
                        — {language === 'fr' ? 'Plus de résultats disponibles…' : 'More results available…'}
                      </span>
                    )}
                  </p>
                )}
                {isRevalidating && (
                  <span className="inline-flex items-center gap-1 text-xs text-blue-400/80 whitespace-normal">
                    <RefreshCw className="h-3 w-3 flex-shrink-0 animate-spin" />
                    {shop.updating || 'Updating…'}
                  </span>
                )}
                {prefetchingNext && !loading && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-amber-400 whitespace-normal">
                    <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin" />
                    {shop.fetchingMoreSources || 'Loading more sources…'}
                  </span>
                )}
              </div>
            </div>

            <div className="flex w-full sm:w-auto items-center gap-2 overflow-visible relative z-20 shrink-0">
              {/* Store Filter */}
              <Select value={providerFilter} onValueChange={(v) => { setProviderFilter(v); setPage(0); }}>
                <SelectTrigger className="w-full sm:w-[160px] bg-white/10 border border-white/20 text-white rounded-lg h-10">
                  <SelectValue placeholder={language === 'fr' ? 'Boutique' : 'Store'} />
                </SelectTrigger>
                <SelectContent className="bg-black border border-white/20 z-[9999]">
                  {[
                    { value: 'all', label: language === 'fr' ? 'Toutes' : 'All Stores' },
                    { value: 'amazon', label: 'Amazon' },
                    { value: 'ebay', label: 'eBay' },
                    { value: 'shein', label: 'SHEIN' },
                    { value: 'carvana', label: 'Carvana' },
                    { value: 'cargurus', label: 'CarGurus' },
                  ].map((opt) => (
                    <SelectItem
                      key={opt.value}
                      value={opt.value}
                      className="text-white hover:bg-white/10 focus:bg-white/10 focus:text-white cursor-pointer"
                    >
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Sort */}
              <Select value={sort} onValueChange={handleSortChange}>
                <SelectTrigger className="w-full sm:w-[220px] bg-white/10 border border-white/20 text-white rounded-lg h-10">
                  <SelectValue placeholder={shop.sortBy || 'Sort by'} />
                </SelectTrigger>
                <SelectContent className="bg-black border border-white/20 z-[9999]">
                  {SORT_OPTIONS.map((option) => (
                    <SelectItem 
                      key={option.value} 
                      value={option.value}
                      className="text-white hover:bg-white/10 focus:bg-white/10 focus:text-white cursor-pointer"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Price filter removed - sort dropdown above handles ordering */}

          {/* Fashion intent banner — shown briefly before auto-redirect to China/Turkey */}
          {intent?.is_fashion && (
            <div className="mb-4 rounded-xl border border-primary/30 bg-primary/10 p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <p className="text-sm text-white/80 flex-1">
                {shop.fashionRedirectBanner ||
                  (language === 'fr'
                    ? 'Pour la mode, la beauté et les chaussures, nous recommandons nos boutiques Chine et Turquie.'
                    : 'For fashion, beauty and shoes we recommend our China and Turkey stores.')}
                {' '}
                <span className="text-white/60">
                  {shop.fashionRedirecting || (language === 'fr' ? 'Redirection…' : 'Redirecting…')}
                </span>
              </p>
              <div className="flex gap-2">
                <Link
                  to="/shop/china"
                  className="inline-flex items-center justify-center gap-1 rounded-lg bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium hover:opacity-90"
                >
                  🇨🇳 {shop.chinaStore || (language === 'fr' ? 'Chine' : 'China')}
                </Link>
                <Link
                  to="/shop/turkey"
                  className="inline-flex items-center justify-center gap-1 rounded-lg border border-white/20 text-white/90 hover:bg-white/10 px-3 py-1.5 text-sm font-medium"
                >
                  🇹🇷 {shop.turkeyStore || (language === 'fr' ? 'Turquie' : 'Turkey')}
                </Link>
              </div>
            </div>
          )}

          {/* Products */}
          <ProductGrid products={products} loading={loading} skeletonCount={24} dense />

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} style={{ height: 1 }} />

          {/* Loading more indicator */}
          {(loadingMore || prefetchingNext) && (
            <div className="flex justify-center mt-8">
              <Loader2 className="h-6 w-6 animate-spin text-white/60" />
            </div>
          )}

          {/* Load More fallback button */}
          {!loading && hasMore && products.length > 0 && !loadingMore && !prefetchingNext && (
            <div className="text-center mt-4">
              <Button
                onClick={handleLoadMore}
                variant="outline"
                className="w-full sm:w-auto border-white/20 text-white hover:bg-white/10 rounded-full px-8"
              >
                {shop.loadMore || 'Load More'}
              </Button>
            </div>
          )}

          {/* No Results */}
          {showEmpty && (
            <div className="text-center py-20">
              {searchError ? (
                <>
                  <AlertCircle className="h-8 w-8 text-red-400 mx-auto mb-3" />
                  <p className="text-red-400 mb-2 font-medium">{shop.searchError || 'Search error'}</p>
                  <p className="text-white/40 text-sm mb-4">{searchError}</p>
                  <Button
                    onClick={() => { setSearchError(null); fetchProducts(0, false); }}
                    variant="outline"
                    className="border-white/20 text-white hover:bg-white/10"
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    {shop.retry || 'Retry'}
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-white/60 mb-6">{shop.noProductsFound || 'No products found'} "{query}"</p>
                  <Link
                    to="/paste-link"
                    className="group relative inline-flex items-center gap-3 overflow-hidden rounded-xl border border-primary/40 bg-gradient-to-r from-primary/25 via-primary/15 to-transparent px-6 py-4 transition-all hover:border-primary/60 hover:shadow-[0_0_25px_-5px_hsl(var(--primary)/0.4)]"
                  >
                    <Link2 className="h-5 w-5 text-primary" />
                    <span className="text-white font-semibold">
                      {language === 'fr'
                        ? "Collez un lien pour le commander"
                        : "Paste a link to order it"}
                    </span>
                    <ArrowRight className="h-4 w-4 text-primary group-hover:translate-x-1 transition-transform" />
                  </Link>
                  <div className="mt-4">
                    <Button
                      onClick={() => navigate('/')}
                      variant="outline"
                      className="border-white/20 text-white hover:bg-white/10"
                    >
                      <X className="h-4 w-4 mr-2" />
                      {shop.clearSearch || 'Clear Search'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </main>
      <BottomNavigation />
    </div>
  );
}
