import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, SlidersHorizontal, X } from 'lucide-react';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { CategoryTabs } from '@/components/shop/CategoryTabs';
import { ProductGrid } from '@/components/shop/ProductGrid';
import { Product } from '@/components/shop/ProductCard';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Slider } from '@/components/ui/slider';
import { cachedCatalogFetch } from '@/lib/catalogCache';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

/** Deduplicate products by id+provider */
function dedupeProducts(list: Product[]): Product[] {
  const seen = new Set<string>();
  return list.filter(p => {
    const key = (p.id || '') + ':' + (p.provider || '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function SearchResults() {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const category = searchParams.get('category') || '';
  const initialSort = searchParams.get('sort') || 'relevance';
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = (t.shop || {}) as any;

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const nextCursorRef = useRef<string | null>(null);
  const [sort, setSort] = useState(initialSort);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 5000]);
  const [totalResults, setTotalResults] = useState(0);

  const SORT_OPTIONS = [
    { value: 'relevance', label: shop.relevance || 'Relevance' },
    { value: 'price_asc', label: shop.priceLowToHigh || 'Price: Low to High' },
    { value: 'price_desc', label: shop.priceHighToLow || 'Price: High to Low' },
    { value: 'rating', label: shop.topRated || 'Top Rated' },
  ];

  const fetchProducts = useCallback(async (pageNum: number, append: boolean = false) => {
    const searchQuery = query || (category ? category.replace(/_/g, ' ') : 'popular');
    const params: Record<string, any> = {
      q: searchQuery.trim().toLowerCase().replace(/\s+/g, ' '),
      limit: 24,
    };

    if (category) {
      params.category_key = category;
    }

    if (sort && sort !== 'relevance') {
      params.sort = sort;
    }

    const filters: Record<string, number> = {};
    if (priceRange[0] > 0) filters.minPrice = priceRange[0];
    if (priceRange[1] < 5000) filters.maxPrice = priceRange[1];
    if (Object.keys(filters).length > 0) {
      params.filters = JSON.stringify(filters);
    }

    // Pagination: prefer cursor, fall back to page number
    if (pageNum > 1 && nextCursorRef.current) {
      params.cursor = nextCursorRef.current;
    } else if (pageNum > 1) {
      params.page = pageNum;
    }

    console.log('[SEARCH] fetch page=', pageNum, 'q=', params.q,
      'cursor=', params.cursor || 'none', 'pageFallback=', params.page || 'none', 'append=', append);

    if (pageNum === 1 && !append) {
      setLoading(true);
    } else if (pageNum > 1) {
      setLoadingMore(true);
    }

    try {
      const data = await cachedCatalogFetch<any>('catalog-search', params, { 
        skipCache: pageNum > 1 
      });

      const mappedProducts: Product[] = (data?.items || []).map((item: any) => ({
        id: item.provider_product_id || item.id,
        provider: item.provider || 'amazon',
        title: item.title || 'Product',
        imageUrl: item.image_url || item.imageUrl || '',
        priceUsd: item.price_usd || item.priceUsd || 0,
        rating: item.rating,
        inStock: item.in_stock !== false,
        productUrl: item.product_url,
      }));

      if (append) {
        setProducts(prev => dedupeProducts([...prev, ...mappedProducts]));
      } else {
        setProducts(mappedProducts);
      }

      const newCursor = data?.nextCursor || null;
      nextCursorRef.current = newCursor;
      // hasMore only when we have a cursor or backend explicitly says so
      setHasMore(!!newCursor || data?.hasMore === true);
      setTotalResults(data?.total || mappedProducts.length);

      console.log('[SEARCH] got items=', mappedProducts.length,
        'nextCursor=', !!newCursor, 'hasMore=', !!newCursor || data?.hasMore === true);
    } catch (err: any) {
      console.error('Search error:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [query, category, sort, priceRange]);

  // Initial search
  useEffect(() => {
    setPage(1);
    nextCursorRef.current = null;
    fetchProducts(1, false);
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

  const handleLoadMore = () => {
    const nextPage = page + 1;
    setPage(nextPage);
    fetchProducts(nextPage, true);
  };

  const handleApplyFilters = () => {
    setPage(1);
    fetchProducts(1, false);
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
                setSearchParams({ q: query, sort });
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
              {!loading && (
                <p className="text-sm text-white/60">
                  {totalResults} {totalResults !== 1 ? (shop.productsFound || 'products found') : (shop.productFound || 'product found')}
                </p>
              )}
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

          {/* Load More */}
          {!loading && hasMore && products.length > 0 && (
            <div className="text-center mt-8">
              <Button
                onClick={handleLoadMore}
                disabled={loadingMore}
                variant="outline"
                className="w-full sm:w-auto border-white/20 text-white hover:bg-white/10 rounded-full px-8"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t.common?.loading || 'Loading...'}
                  </>
                ) : (
                  shop.loadMore || 'Load More'
                )}
              </Button>
            </div>
          )}

          {/* No Results */}
          {!loading && products.length === 0 && (
            <div className="text-center py-20">
              <p className="text-white/60 mb-4">{shop.noProductsFound || 'No products found'} "{query}"</p>
              <Button
                onClick={() => setSearchParams({})}
                variant="outline"
                className="border-white/20 text-white hover:bg-white/10"
              >
                <X className="h-4 w-4 mr-2" />
                {shop.clearSearch || 'Clear Search'}
              </Button>
            </div>
          )}
        </div>
      </main>
      <BottomNavigation />
    </div>
  );
}
