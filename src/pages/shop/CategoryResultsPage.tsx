import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { ShopFooter } from '@/components/shop/ShopFooter';
import { ProductCard, Product } from '@/components/shop/ProductCard';
import { Button } from '@/components/ui/button';
import { cachedCatalogFetch } from '@/lib/catalogCache';
import { isRenderableImageUrl } from '@/lib/imageValidation';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { applyServerPrices } from '@/lib/serverPricing';

const CATEGORY_TITLE_MAP: Record<string, Record<string, string>> = {
  all: { fr: 'Toutes les catégories', en: 'All Categories' },
  phones: { fr: 'Téléphones', en: 'Phones' },
  electronics: { fr: 'Électronique', en: 'Electronics' },
  gaming: { fr: 'Jeux Vidéo', en: 'Gaming' },
  vehicles: { fr: 'Véhicules', en: 'Vehicles' },
  clothing: { fr: 'Mode', en: 'Fashion' },
  home_garden: { fr: 'Salon, Salle à Manger & Cuisine', en: 'Home & Living' },
  toys: { fr: 'Jouets', en: 'Toys' },
  sporting_goods: { fr: 'Sport', en: 'Sports' },
  jewelry_watches: { fr: 'Montres & Bijoux', en: 'Jewelry & Watches' },
  parts_accessories: { fr: 'Pièces Auto', en: 'Parts & Accessories' },
  refurbished: { fr: 'Reconditionné', en: 'Refurbished' },
  audio_music: { fr: 'Audio & Musique', en: 'Audio & Music' },
  beauty_health: { fr: 'Beauté & Santé', en: 'Beauty & Health' },
  collectibles: { fr: 'Collections', en: 'Collectibles' },
  shoes_sneakers: { fr: 'Chaussures & Sneakers', en: 'Shoes & Sneakers' },
  cameras_photo: { fr: 'Caméras & Photo', en: 'Cameras & Photo' },
};

interface CategoryItem {
  id?: string;
  provider_product_id?: string;
  providerProductId?: string;
  provider?: string;
  title?: string;
  image_url?: string;
  imageUrl?: string;
  mainImageUrl?: string;
  price_usd?: number;
  priceUsd?: number;
  rating?: number;
  in_stock?: boolean;
  inStock?: boolean;
  product_url?: string;
  productUrl?: string;
}

interface CategoryResponse {
  status: string;
  items: CategoryItem[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
  // Also support legacy sections format from catalog-home
  sections?: Array<{ items: CategoryItem[] }>;
}

const PAGE_SIZE = 200;

export default function CategoryResultsPage() {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const { language } = useLanguage();

  const categoryKey = key || 'all';
  const title = CATEGORY_TITLE_MAP[categoryKey]?.[language] || CATEGORY_TITLE_MAP[categoryKey]?.en || categoryKey;

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const seenIdsRef = useRef(new Set<string>());
  const cursorRef = useRef<string | null>(null);
  const exhaustedRef = useRef(false);

  const mapItem = (item: CategoryItem): Product => {
    const rawImage = item.mainImageUrl || item.image_url || item.imageUrl || '';
    return {
      id: item.providerProductId || item.provider_product_id || item.id || '',
      provider: item.provider || 'amazon',
      title: item.title || 'Product',
      imageUrl: isRenderableImageUrl(rawImage) ? rawImage : '',
      priceUsd: item.price_usd || item.priceUsd || 0,
      rating: item.rating,
      inStock: (item.in_stock ?? item.inStock) !== false,
      productUrl: item.productUrl || item.product_url,
    };
  };

  // Filter out phone accessories from Pièces Auto results
  const PARTS_PHONE_JUNK = [
    'phone mount', 'phone holder', 'phone case', 'phone cradle', 'cell phone',
    'iphone', 'samsung galaxy', 'screen protector', 'tempered glass', 'phone stand',
    'tablet holder', 'tablet mount', 'mama bear', 'magnetic case for iphone',
    'usb c charger for lg', 'usb-c laptop car charger',
  ];
  const isRelevantPartsItem = (p: Product): boolean => {
    if (categoryKey !== 'parts_accessories') return true;
    const t = (p.title || '').toLowerCase();
    return !PARTS_PHONE_JUNK.some(junk => t.includes(junk));
  };

  // Direct DB fetch for "all" category
  const fetchAllFromDb = useCallback(async (offset: number): Promise<Product[]> => {
    console.log('[CategoryPage] fetching ALL from DB, offset', offset);
    const PAGE = 200;
    const { data, error } = await supabase
      .from('catalog_items')
      .select('id, provider, provider_product_id, title, image_url, images, product_url, price_usd, rating, in_stock')
      .eq('is_active', true)
      .eq('is_disallowed', false)
      .gt('price_usd', 0)
      .order('popularity_score', { ascending: false, nullsFirst: false })
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error('[CategoryPage] DB error:', error);
      exhaustedRef.current = true;
      return [];
    }

    if (!data || data.length < PAGE) {
      exhaustedRef.current = true;
    }

    const items = (data || [])
      .map((item: any) => {
        const mapped = mapItem(item);
        return { ...mapped, priceUsd: applyFees(mapped.priceUsd, mapped.title) };
      })
      .filter(p => p.id && p.imageUrl && p.priceUsd > 0 && !seenIdsRef.current.has(p.id));

    items.forEach(p => seenIdsRef.current.add(p.id));
    console.log('[CategoryPage] DB fetched:', items.length, 'new items');
    return items;
  }, []);

  const fetchPage = useCallback(async (cursor: string | null): Promise<Product[]> => {
    console.log('[CategoryPage] fetching cursor', cursor, 'for', categoryKey);
    const params: Record<string, unknown> = {
      category: categoryKey,
      pageSize: PAGE_SIZE,
      client: 'web',
      language,
    };
    if (cursor) params.cursor = cursor;

    const data = await cachedCatalogFetch<CategoryResponse>('catalog-category', params);

    // Store cursor for next request
    cursorRef.current = data?.nextCursor || null;

    const rawItems: CategoryItem[] = data?.items || data?.sections?.[0]?.items || [];
    
    const items = rawItems
      .map(mapItem)
      .filter(p => p.id && p.imageUrl && p.priceUsd > 0 && !seenIdsRef.current.has(p.id))
      .filter(isRelevantPartsItem);

    items.forEach(p => seenIdsRef.current.add(p.id));

    console.log('[CategoryPage] fetched:', items.length, 'new items, nextCursor:', cursorRef.current);

    if (!cursorRef.current || data?.hasMore === false || rawItems.length === 0) {
      exhaustedRef.current = true;
    }

    return items;
  }, [categoryKey, language]);

  // Track DB offset for "all" pagination
  const dbOffsetRef = useRef(0);
  // Store total count from backend
  const [totalCount, setTotalCount] = useState(0);

  // Direct DB fetch for category pagination (fast, <100ms)
  const fetchCategoryFromDb = useCallback(async (catKey: string, offset: number): Promise<Product[]> => {
    console.log('[CategoryPage] direct DB fetch for', catKey, 'offset', offset);
    const PAGE = 200;
    const { data, error } = await supabase
      .from('catalog_items')
      .select('id, provider, provider_product_id, title, image_url, images, product_url, price_usd, rating, in_stock')
      .eq('is_active', true)
      .eq('is_disallowed', false)
      .eq('unified_category', catKey)
      .gt('price_usd', 0)
      .order('popularity_score', { ascending: false, nullsFirst: false })
      .range(offset, offset + PAGE - 1);

    if (error) {
      console.error('[CategoryPage] DB error:', error);
      exhaustedRef.current = true;
      return [];
    }
    if (!data || data.length < PAGE) {
      exhaustedRef.current = true;
    }
    const items = (data || [])
      .map((item: any) => {
        const mapped = mapItem(item);
        return { ...mapped, priceUsd: applyFees(mapped.priceUsd, mapped.title) };
      })
      .filter(p => p.id && p.imageUrl && p.priceUsd > 0 && !seenIdsRef.current.has(p.id))
      .filter(isRelevantPartsItem);
    items.forEach(p => seenIdsRef.current.add(p.id));
    return items;
  }, []);

  // Initial load — fetch first page only, show immediately
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProducts([]);
    seenIdsRef.current.clear();
    cursorRef.current = null;
    exhaustedRef.current = false;
    dbOffsetRef.current = 0;
    setTotalCount(0);

    (async () => {
      let firstBatch: Product[];
      if (categoryKey === 'all') {
        firstBatch = await fetchAllFromDb(0);
        dbOffsetRef.current = 200;
      } else {
        // Use edge function for first page (gets total count + mixed results)
        firstBatch = await fetchPage(null);
        // Also get real DB count for total display
        try {
          const { count } = await supabase
            .from('catalog_items')
            .select('id', { count: 'exact', head: true })
            .eq('unified_category', categoryKey)
            .eq('is_active', true)
            .eq('is_disallowed', false)
            .gt('price_usd', 0);
          setTotalCount(count || firstBatch.length);
        } catch {
          setTotalCount(firstBatch.length);
        }
        dbOffsetRef.current = firstBatch.length;
      }
      if (cancelled) return;
      setProducts(firstBatch);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [categoryKey, fetchPage, fetchAllFromDb]);

  // Manual Load More — fetches next page directly from DB for speed
  const handleShowMore = () => {
    if (exhaustedRef.current || loadingMore) return;
    setLoadingMore(true);

    const fetchMore = categoryKey === 'all'
      ? fetchAllFromDb(dbOffsetRef.current).then(items => { dbOffsetRef.current += 200; return items; })
      : fetchCategoryFromDb(categoryKey, dbOffsetRef.current).then(items => { dbOffsetRef.current += 200; return items; });

    fetchMore.then(items => {
      if (items.length > 0) {
        setProducts(prev => [...prev, ...items]);
      }
      setLoadingMore(false);
    }).catch(() => setLoadingMore(false));
  };

  const hasMore = !exhaustedRef.current;

  return (
    <div className="min-h-screen bg-[#0f1115] pb-safe-nav">
      <ShopHeader />
      <div className="pt-16 md:pt-20" />

      <main className="pb-8">
        <div className="container mx-auto px-3 sm:px-4">
          {/* Back + Title */}
          <div className="flex items-center gap-3 mb-5 mt-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (window.history.length > 1) {
                  navigate(-1);
                } else {
                  navigate('/');
                }
              }}
              className="text-white/70 hover:text-white hover:bg-white/10 rounded-full h-10 w-10"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold text-white/95">{title}</h1>
            {!loading && (
              <span className="text-sm text-white/40 ml-auto">
                {products.length}{totalCount > products.length ? ` / ${totalCount.toLocaleString()}` : ''} {language === 'fr' ? 'produits' : 'products'}
              </span>
            )}
          </div>

           {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-[#1a1d23] border border-white/[0.08] rounded-xl p-3 animate-pulse">
                    <div className="aspect-square bg-white/[0.06] rounded-lg mb-2" />
                    <div className="h-3 w-3/4 bg-white/[0.06] rounded mb-1" />
                    <div className="h-3 w-1/2 bg-white/[0.06] rounded" />
                  </div>
                ))}
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-white/50">{language === 'fr' ? 'Aucun produit trouvé' : 'No products found'}</p>
            </div>
          ) : (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {products.map((product) => (
                  <ProductCard key={`${product.provider}-${product.id}`} product={product} />
                ))}
              </div>

              {hasMore && (
                <div className="flex justify-center mt-8">
                  <Button
                    onClick={handleShowMore}
                    disabled={loadingMore}
                    variant="outline"
                    className="border-white/20 bg-white/[0.04] text-white/90 hover:bg-white/[0.08] hover:border-white/30 rounded-full px-8 py-3"
                    size="lg"
                  >
                    {loadingMore ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : null}
                    {language === 'fr' ? 'Afficher plus' : 'Show More'}
                    <span className="ml-2 text-xs text-white/50">
                      ({products.length}{totalCount > 0 ? ` / ${totalCount.toLocaleString()}` : ''})
                    </span>
                  </Button>
                </div>
              )}
            </motion.div>
          )}
        </div>
      </main>

      <ShopFooter />
      <BottomNavigation />
    </div>
  );
}
