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

/** Generate a unique key per product for deduplication */
function productKey(p: Product): string {
  if (p.productUrl) {
    try {
      const u = new URL(p.productUrl);
      return u.hostname + u.pathname;
    } catch { /* fall through */ }
  }
  return (p.id || '') + ':' + (p.provider || '');
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
  const [page, setPage] = useState(0); // 0-based page index
  const [sort, setSort] = useState(initialSort);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 5000]);
  const [totalResults, setTotalResults] = useState(0);
  const [incomplete, setIncomplete] = useState(false);
  const [prefetchingNext, setPrefetchingNext] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Persistent seenIds across pages — reset on new search
  const seenIdsRef = useRef<Set<string>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);

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

  /** Build URL for a given page */
  const buildFetchUrl = useCallback((pageNum: number) => {
    const IGNORED_CATEGORIES = new Set(['', 'all', 'home', 'accueil']);
    const effectiveCategory = IGNORED_CATEGORIES.has(category.toLowerCase()) ? '' : category;
    const searchQuery = query || DEFAULT_CATEGORY_QUERIES[effectiveCategory] || effectiveCategory.replace(/_/g, ' ') || 'popular';
    const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/catalog-search`);
    // Send raw query — backend handles its own normalization
    url.searchParams.set('q', searchQuery.trim());
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('page', String(pageNum));

    // Only send category when it's a real filter, not home/accueil
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

    console.log('[SEARCH_DEBUG] fetchUrl:', url.toString());
    return url.toString();
  }, [query, category, sort, priceRange]);

  // Track current query identity so prefetch can check staleness
  const searchIdentityRef = useRef('');

  const fetchProducts = useCallback(async (pageNum: number, append: boolean = false) => {
    // Only abort in-flight requests for NEW searches (page 0), not pagination
    if (pageNum === 0 && abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    if (pageNum === 0) {
      abortControllerRef.current = controller;
    }

    const currentIdentity = `${query}|${category}|${sort}`;

    // Reset seenIds on fresh search
    if (pageNum === 0 && !append) {
      seenIdsRef.current = new Set();
      searchIdentityRef.current = currentIdentity;
      setLoading(true);
      setIncomplete(false);
      setSearchError(null);
    } else if (pageNum > 0) {
      setLoadingMore(true);
    }

    try {
      const fetchUrl = buildFetchUrl(pageNum);
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
      if (!response.ok) {
        const errText = await response.text();
        console.error('[SEARCH_ERROR] status:', response.status, 'body:', errText);
        throw new Error(`Search failed: ${response.status}`);
      }

      const data = await response.json();
      console.log('[SEARCH_DEBUG] response:', { page: pageNum, returnedCount: data?.items?.length, hasMore: data?.hasMore, incomplete: data?.incomplete, partial: data?.partial, providersStatus: data?.providersStatus });
      const mappedProducts = mapItems(data?.items || []);

      // Track incomplete (provider timeouts)
      const isIncomplete = !!data?.incomplete || !!data?.partial;

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

      // hasMore from backend (already accounts for incomplete/timeouts)
      const backendHasMore = data?.hasMore === true;
      setHasMore(backendHasMore && pageNum < MAX_PAGES - 1);
      setIncomplete(isIncomplete);

      // Auto-prefetch page 1 if page 0 was incomplete
      if (pageNum === 0 && isIncomplete && backendHasMore) {
        setPrefetchingNext(true);
        setTimeout(() => {
          // Only prefetch if we're still on the same search
          if (searchIdentityRef.current === currentIdentity) {
            prefetchNextPage(1);
          } else {
            setPrefetchingNext(false);
          }
        }, 500);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Search error:', err);
      setSearchError(err.message || 'Search failed');
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [buildFetchUrl, query, category, sort]);

  /** Prefetch next page in background and append results */
  const prefetchNextPage = useCallback(async (nextPageNum: number) => {
    try {
      const fetchUrl = buildFetchUrl(nextPageNum);
      const response = await fetch(fetchUrl, {
        method: 'GET',
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) return;
      const data = await response.json();
      const mappedProducts = mapItems(data?.items || []);
      const newUnique = dedupeWithSet(mappedProducts, seenIdsRef.current);

      if (newUnique.length > 0) {
        setProducts(prev => {
          const combined = [...prev, ...newUnique];
          setTotalResults(combined.length);
          return combined;
        });
        setPage(nextPageNum);
      }

      const backendHasMore = data?.hasMore === true;
      setHasMore(backendHasMore && nextPageNum < MAX_PAGES - 1);
      setIncomplete(!!data?.incomplete || !!data?.partial);
    } catch {
      // Prefetch failed silently — user can still use Load More
    } finally {
      setPrefetchingNext(false);
    }
  }, [buildFetchUrl]);

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

  // Initial search
  useEffect(() => {
    setPage(0);
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

  const handleLoadMore = useCallback(() => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchProducts(nextPage, true);
  }, [page, fetchProducts]);

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loading || loadingMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) handleLoadMore(); },
      { rootMargin: '400px' }
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, handleLoadMore]);

  const handleApplyFilters = () => {
    setPage(0);
    fetchProducts(0, false);
  };

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
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <div>
              {query && (
                <h1 className="text-lg md:text-xl font-bold text-white">
                  {shop.resultsFor || 'Results for'} "{query}"
                </h1>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {!loading && (
                  <p className="text-sm text-white/60">
                    {totalResults} {totalResults !== 1 ? (shop.productsFound || 'products found') : (shop.productFound || 'product found')}
                  </p>
                )}
                {isRevalidating && (
                  <span className="inline-flex items-center gap-1 text-xs text-blue-400/80">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    {shop.updating || 'Updating…'}
                  </span>
                )}
                {prefetchingNext && !loading && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-amber-400">
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

          {/* Products */}
          <ProductGrid products={products} loading={loading} skeletonCount={12} />

          {/* Infinite scroll sentinel — ALWAYS rendered when more pages possible */}
          {hasMore && products.length > 0 && (
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

          {/* No Results */}
          {!loading && products.length === 0 && (
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