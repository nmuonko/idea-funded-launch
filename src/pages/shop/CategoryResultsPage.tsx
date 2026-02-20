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
import { useLanguage } from '@/contexts/LanguageContext';

const CATEGORY_TITLE_MAP: Record<string, Record<string, string>> = {
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

const POOL_TARGET = 300;
const PAGE_SIZE = 100;
const VISIBLE_STEP = 48;

export default function CategoryResultsPage() {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const { language } = useLanguage();

  const categoryKey = key || 'all';
  const title = CATEGORY_TITLE_MAP[categoryKey]?.[language] || CATEGORY_TITLE_MAP[categoryKey]?.en || categoryKey;

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [visibleCount, setVisibleCount] = useState(VISIBLE_STEP);
  const seenIdsRef = useRef(new Set<string>());
  const cursorRef = useRef<string | null>(null);
  const exhaustedRef = useRef(false);

  const mapItem = (item: CategoryItem): Product => ({
    id: item.providerProductId || item.provider_product_id || item.id || '',
    provider: item.provider || 'amazon',
    title: item.title || 'Product',
    imageUrl: item.mainImageUrl || item.image_url || item.imageUrl || '',
    priceUsd: item.price_usd || item.priceUsd || 0,
    rating: item.rating,
    inStock: (item.in_stock ?? item.inStock) !== false,
    productUrl: item.productUrl || item.product_url,
  });

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
      .filter(p => p.id && p.imageUrl && p.priceUsd > 0 && !seenIdsRef.current.has(p.id));

    items.forEach(p => seenIdsRef.current.add(p.id));

    console.log('[CategoryPage] fetched:', items.length, 'new items, nextCursor:', cursorRef.current);

    if (!cursorRef.current || data?.hasMore === false || rawItems.length === 0) {
      exhaustedRef.current = true;
    }

    return items;
  }, [categoryKey, language]);

  // Initial load — fetch multiple pages to fill pool
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProducts([]);
    seenIdsRef.current.clear();
    cursorRef.current = null;
    exhaustedRef.current = false;
    setVisibleCount(VISIBLE_STEP);

    (async () => {
      const accumulated: Product[] = [];
      let requestCount = 0;
      let emptyStreak = 0;
      while (accumulated.length < POOL_TARGET && !exhaustedRef.current && requestCount < 10) {
        const items = await fetchPage(cursorRef.current);
        if (cancelled) return;
        if (items.length === 0) {
          emptyStreak++;
          if (emptyStreak >= 3) { exhaustedRef.current = true; break; }
        } else {
          emptyStreak = 0;
          accumulated.push(...items);
          setLoadProgress(accumulated.length);
        }
        requestCount++;
      }
      if (!cancelled) {
        setProducts(accumulated);
        setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [categoryKey, fetchPage]);

  const handleShowMore = () => {
    const nextVisible = visibleCount + VISIBLE_STEP;
    setVisibleCount(nextVisible);

    // If we're nearing the end of the pool and not exhausted, fetch more
    if (nextVisible >= products.length - VISIBLE_STEP && !exhaustedRef.current && !loadingMore) {
      setLoadingMore(true);
      fetchPage(cursorRef.current).then(items => {
        setProducts(prev => [...prev, ...items]);
        setLoadingMore(false);
      }).catch(() => setLoadingMore(false));
    }
  };

  const visibleProducts = products.slice(0, visibleCount);
  const hasMore = visibleCount < products.length || !exhaustedRef.current;

  return (
    <div className="min-h-screen bg-[#0f1115] pb-20 md:pb-0">
      <ShopHeader />
      <div className="pt-16 md:pt-20" />

      <main className="pb-8">
        <div className="container mx-auto px-3 sm:px-4">
          {/* Back + Title */}
          <div className="flex items-center gap-3 mb-5 mt-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(-1)}
              className="text-white/70 hover:text-white hover:bg-white/10 rounded-full h-10 w-10"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-bold text-white/95">{title}</h1>
            {!loading && (
              <span className="text-sm text-white/40 ml-auto">
                {products.length} {language === 'fr' ? 'produits' : 'products'}
              </span>
            )}
          </div>

          {loading ? (
            <div>
              {loadProgress > 0 && (
                <div className="text-center mb-4">
                  <p className="text-white/60 text-sm">
                    {language === 'fr' ? 'Chargement...' : 'Loading...'} {loadProgress} {language === 'fr' ? 'produits trouvés' : 'products found'}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-[#1a1d23] border border-white/[0.08] rounded-xl p-3 animate-pulse">
                    <div className="aspect-square bg-white/[0.06] rounded-lg mb-2" />
                    <div className="h-3 w-3/4 bg-white/[0.06] rounded mb-1" />
                    <div className="h-3 w-1/2 bg-white/[0.06] rounded" />
                  </div>
                ))}
              </div>
            </div>
          ) : products.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-white/50">{language === 'fr' ? 'Aucun produit trouvé' : 'No products found'}</p>
            </div>
          ) : (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {visibleProducts.map((product) => (
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
                      ({visibleCount} / {products.length}{!exhaustedRef.current ? '+' : ''})
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
