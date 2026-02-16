import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Loader2, SlidersHorizontal, X, RefreshCw, AlertCircle } from 'lucide-react';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { CategoryTabs } from '@/components/shop/CategoryTabs';
import { ProductGrid } from '@/components/shop/ProductGrid';
import { Product } from '@/components/shop/ProductCard';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { normalizeQuery, stableStringify } from '@/lib/catalogCache';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

const PAGE_SIZE = 100;
const HARD_MAX_ITEMS = 500;
const MAX_PAGES = Math.ceil(HARD_MAX_ITEMS / PAGE_SIZE); // 5

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

export default function SearchResults() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const query = searchParams.get('q') || '';
  const category = searchParams.get('category') || '';
  const initialSort = searchParams.get('sort') || 'relevance';
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = (t.shop || {}) as any;

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState(initialSort);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 5000]);
  const [totalResults, setTotalResults] = useState(0);
  const [incomplete, setIncomplete] = useState(false);
  const [prefetchingNext, setPrefetchingNext] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorMode, setCursorMode] = useState(false);
  const [providersStatus, setProvidersStatus] = useState<any>(null);
  const [showProviderDebug, setShowProviderDebug] = useState(false);

  const seenIdsRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeSearchTokenRef = useRef(0);
  const revalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageRef = useRef(0);

  const SORT_OPTIONS = [
    { value: 'relevance', label: shop.relevance || 'Relevance' },
    { value: 'price_asc', label: shop.priceLowToHigh || 'Price: Low to High' },
    { value: 'price_desc', label: shop.priceHighToLow || 'Price: High to Low' },
    { value: 'rating', label: shop.topRated || 'Top Rated' },
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

  const buildFetchUrl = useCallback((pageNum: number, cursor?: string | null) => {
    const IGNORED_CATEGORIES = new Set(['', 'all', 'home', 'accueil']);
    const effectiveCategory = IGNORED_CATEGORIES.has(category.toLowerCase()) ? '' : category;
    const searchQuery = query || DEFAULT_CATEGORY_QUERIES[effectiveCategory] || effectiveCategory.replace(/_/g, ' ') || 'popular';
    const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/catalog-search`);
    url.searchParams.set('q', searchQuery.trim());
    url.searchParams.set('limit', String(PAGE_SIZE));

    // Use cursor if in cursor mode and cursor exists, otherwise use page number
    if (cursor) {
      url.searchParams.set('cursor', cursor);
    }
    url.searchParams.set('page', String(pageNum));

    if (effectiveCategory) {
      url.searchParams.set('category_key', effectiveCategory);
    }
    if (sort && sort !== 'relevance') url.searchParams.set('sort', sort);

    const filters: Record<string, number> = {};
    if (priceRange[0] > 0) filters.minPrice = priceRange[0];
    if (priceRange[1] < 5000) filters.maxPrice = priceRange[1];
    if (Object.keys(filters).length > 0) {
      url.searchParams.set('filters', stableStringify(filters));
    }

    return url.toString();
  }, [query, category, sort, priceRange]);

  const searchIdentityRef = useRef('');

  /** Map raw API items to Product interface */
  function mapItems(items: any[]): Product[] {
    return items.map((item: any) => ({
      id: item.provider_product_id || item.id,
      provider: item.provider || 'amazon',
      title: item.title || 'Product',
      imageUrl: item.image_url || item.imageUrl || '',
      priceUsd: item.price_usd || item.priceUsd || 0,
      rating: item.rating,
      inStock: item.in_stock !== false,
      productUrl: item.product_url,
    }));
  }

  const fetchProducts = useCallback(async (pageNum: number, append: boolean = false, cursorVal?: string | null) => {
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
      pageRef.current = 0;
      if (revalidateTimerRef.current) {
        clearTimeout(revalidateTimerRef.current);
        revalidateTimerRef.current = null;
      }
      setLoading(true);
      setHasSearched(false);
      setHasMore(true);
      setProducts([]);
      setTotalResults(0);
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
      const fetchUrl = buildFetchUrl(pageNum, effectiveCursor);
      const response = await fetch(fetchUrl, {
        method: 'GET',
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;
      if (token !== null && token !== activeSearchTokenRef.current) return;

      if (!response.ok) {
        const errText = await response.text();
        console.error('[SEARCH_ERROR] status:', response.status, 'body:', errText);
        throw new Error(`Search failed: ${response.status}`);
      }

      const data = await response.json();
      const returnedCount = data?.items?.length || 0;
      const isIncomplete = !!data?.incomplete || !!data?.partial;
      const backendHasMore = data?.hasMore === true;

      // Extract cursor from any possible location in response
      const responseCursor = data?.cursor || data?.nextCursor || data?.cursorNext || data?.meta?.cursor || data?.meta?.nextCursor || null;

      console.log('[SEARCH_RES]', { page: pageNum, got: returnedCount, hasMore: backendHasMore, incomplete: isIncomplete, nextCursor: responseCursor, totalFromBackend: data?.total, providersStatus: data?.providersStatus });

      // Store provider debug info
      if (data?.providersStatus) {
        setProvidersStatus(data.providersStatus);
      }

      // If backend returns a cursor, switch to cursor mode
      if (responseCursor) {
        setCursorMode(true);
        setNextCursor(responseCursor);
      } else {
        setNextCursor(null);
      }

      const mappedProducts = mapItems(data?.items || []);

      if (append) {
        const newUnique = dedupeWithSet(mappedProducts, seenIdsRef.current);
        setProducts(prev => {
          const combined = [...prev, ...newUnique];
          setTotalResults(combined.length);
          return combined;
        });
      } else {
        seenIdsRef.current = new Set();
        const deduped = dedupeWithSet(mappedProducts, seenIdsRef.current);
        setProducts(deduped);
        setTotalResults(deduped.length);
      }

      // hasMore: backend says more OR incomplete OR cursor exists OR returned near-full page, within page limit
      const returnedNearFullPage = returnedCount >= Math.floor(PAGE_SIZE * 0.5); // 50+ items suggests more exist
      const computedHasMore = (backendHasMore || (isIncomplete && returnedCount > 0) || !!responseCursor || returnedNearFullPage) && pageNum < MAX_PAGES - 1;
      setHasMore(computedHasMore);
      setIncomplete(isIncomplete);

      console.log('[SEARCH_PAGINATION]', { pageNum, computedHasMore, backendHasMore, isIncomplete, hasCursor: !!responseCursor, returnedCount, maxPages: MAX_PAGES });

      // Auto-revalidate page 0 if incomplete (background enrichment)
      if (pageNum === 0 && isIncomplete && !append) {
        const capturedToken = token ?? activeSearchTokenRef.current;
        revalidateTimerRef.current = setTimeout(() => {
          if (capturedToken !== activeSearchTokenRef.current) return;
          revalidateInBackground(capturedToken);
        }, 500);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      if (token !== null && token !== activeSearchTokenRef.current) return;
      console.error('Search error:', err);
      setSearchError(err.message || 'Search failed');
      setHasSearched(true);
    } finally {
      if (!controller.signal.aborted) {
        if (token === null || token === activeSearchTokenRef.current) {
          setLoading(false);
          setHasSearched(true);
        }
        setLoadingMore(false);
      }
    }
  }, [buildFetchUrl, query, category, sort]);

  /** Background revalidation to enrich incomplete page-0 results */
  const revalidateInBackground = useCallback(async (token: number) => {
    if (token !== activeSearchTokenRef.current) return;
    setIsRevalidating(true);
    setPrefetchingNext(true);
    try {
      const fetchUrl = buildFetchUrl(0);
      const response = await fetch(fetchUrl, {
        method: 'GET',
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
      if (token !== activeSearchTokenRef.current) return;
      if (!response.ok) return;

      const data = await response.json();
      const mappedProducts = mapItems(data?.items || []);
      const newUnique = dedupeWithSet(mappedProducts, seenIdsRef.current);

      if (newUnique.length > 0 && token === activeSearchTokenRef.current) {
        setProducts(prev => {
          const combined = [...prev, ...newUnique];
          setTotalResults(combined.length);
          return combined;
        });
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
  }, [buildFetchUrl]);

  // Initial search
  useEffect(() => {
    setPage(0);
    pageRef.current = 0;
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
    if (loadingRef.current || loadingMoreRef.current || !hasMoreRef.current) {
      console.log('[LOADMORE_SKIP]', { loading: loadingRef.current, loadingMore: loadingMoreRef.current, hasMore: hasMoreRef.current });
      return;
    }
    const nextPage = pageRef.current + 1;
    pageRef.current = nextPage;
    setPage(nextPage);
    const cursorToUse = cursorModeRef.current ? nextCursorRef.current : null;
    console.log('[LOADMORE]', { nextPage, cursorMode: cursorModeRef.current, cursor: cursorToUse });
    fetchProducts(nextPage, true, cursorToUse);
  }, [fetchProducts]);

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sentinelRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        if (loading || loadingMore) return;
        if (!hasMore) return;
        handleLoadMore();
      },
      { rootMargin: '400px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, handleLoadMore]);

  const handleApplyFilters = () => {
    setPage(0);
    fetchProducts(0, false);
  };

  // Derived: only show empty state when truly done
  const showEmpty = hasSearched && !loading && !loadingMore && !prefetchingNext && !isRevalidating && !incomplete && products.length === 0;

  return (
    <div className="min-h-screen bg-black">
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
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-6 mt-2">
            <div className="min-w-0 shrink">
              {query && (
                <h1 className="text-lg md:text-xl font-bold text-white whitespace-normal break-words leading-snug">
                  {shop.resultsFor || 'Results for'} "{query}"
                </h1>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
                {!loading && hasSearched && (
                  <p className="text-sm text-white/60 whitespace-normal break-words leading-snug">
                    {totalResults} {totalResults !== 1 ? (shop.productsFound || 'products found') : (shop.productFound || 'product found')}
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

            <div className="flex items-center gap-2">
              {/* Sort */}
              <Select value={sort} onValueChange={handleSortChange}>
                <SelectTrigger className="w-[160px] bg-white/5 border-white/10 text-white">
                  <SelectValue placeholder={shop.sortBy || 'Sort by'} />
                </SelectTrigger>
                <SelectContent className="bg-black/95 border-white/10">
                  {SORT_OPTIONS.map((option) => (
                    <SelectItem 
                      key={option.value} 
                      value={option.value}
                      className="text-white hover:bg-white/10"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Filters */}
              <Sheet>
                <SheetTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="border-white/10 text-white hover:bg-white/10"
                  >
                    <SlidersHorizontal className="h-4 w-4 mr-2" />
                    {shop.filters || 'Filters'}
                  </Button>
                </SheetTrigger>
                <SheetContent className="bg-black/95 border-white/10">
                  <SheetHeader>
                    <SheetTitle className="text-white">{shop.filters || 'Filters'}</SheetTitle>
                  </SheetHeader>
                  
                  <div className="mt-6 space-y-6">
                    <div>
                      <label className="text-sm text-white/70 mb-3 block">
                        {shop.priceRange || 'Price Range'}: ${priceRange[0]} - ${priceRange[1]}
                      </label>
                      <Slider
                        value={priceRange}
                        onValueChange={(value) => setPriceRange(value as [number, number])}
                        min={0}
                        max={5000}
                        step={50}
                        className="py-4"
                      />
                    </div>

                    <Button 
                      onClick={handleApplyFilters}
                      className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 text-white"
                    >
                      {shop.applyFilters || 'Apply Filters'}
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>

          {/* Provider Debug (DEV only) */}
          {providersStatus && import.meta.env.DEV && (
            <div className="mb-4">
              <button
                onClick={() => setShowProviderDebug(v => !v)}
                className="text-xs text-white/40 hover:text-white/70 underline"
              >
                {showProviderDebug ? 'Hide' : 'Show'} Provider Debug
              </button>
              {showProviderDebug && (
                <pre className="mt-2 p-3 rounded text-xs text-white/60 bg-white/5 border border-white/10 overflow-x-auto max-h-40">
                  {JSON.stringify({
                    amazon: providersStatus.amazon,
                    ebay: providersStatus.ebay,
                    hasMore,
                    totalResults,
                    page,
                    incomplete,
                  }, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* Products */}
          <ProductGrid products={products} loading={loading} skeletonCount={12} />

          {/* Infinite scroll sentinel — ALWAYS rendered when hasMore */}
          {hasMore && (
            <div ref={sentinelRef} style={{ height: 1 }} />
          )}

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

          {/* No Results — ONLY after all loading/revalidation/incomplete done */}
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
                  <p className="text-white/60 mb-4">{shop.noProductsFound || 'No products found'} "{query}"</p>
                  <Button
                    onClick={() => navigate('/')}
                    variant="outline"
                    className="border-white/20 text-white hover:bg-white/10"
                  >
                    <X className="h-4 w-4 mr-2" />
                    {shop.clearSearch || 'Clear Search'}
                  </Button>
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
