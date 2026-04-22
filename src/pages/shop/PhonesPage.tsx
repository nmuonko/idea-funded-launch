import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Loader2, ShieldCheck, Truck, Headphones, RotateCcw,
  Filter as FilterIcon, X, ChevronDown,
} from 'lucide-react';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { ShopFooter } from '@/components/shop/ShopFooter';
import { ProductCard, Product } from '@/components/shop/ProductCard';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { isRenderableImageUrl } from '@/lib/imageValidation';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { applyServerPrices } from '@/lib/serverPricing';

const PAGE_SIZE = 200;

const STORAGE_OPTIONS = ['64GB', '128GB', '256GB', '512GB', '1TB'];
const CONDITION_OPTIONS = [
  { key: 'excellent', en: 'Excellent', fr: 'Excellent',  match: ['excellent', 'mint', 'pristine', 'like new'] },
  { key: 'good',      en: 'Good',      fr: 'Bon',         match: ['good condition', 'good ', 'very good'] },
  { key: 'fair',      en: 'Fair',      fr: 'Correct',     match: ['fair', 'acceptable', 'used'] },
  { key: 'new',       en: 'New',       fr: 'Neuf',        match: ['new', 'brand new', 'sealed', 'unopened'] },
];
const CARRIER_OPTIONS = [
  { key: 'unlocked', en: 'Unlocked',  fr: 'Débloqué',  match: ['unlocked', 'sim free', 'sim-free'] },
  { key: 'att',      en: 'AT&T',      fr: 'AT&T',      match: ['at&t', 'att '] },
  { key: 'tmobile',  en: 'T-Mobile',  fr: 'T-Mobile',  match: ['t-mobile', 'tmobile'] },
  { key: 'verizon',  en: 'Verizon',   fr: 'Verizon',   match: ['verizon'] },
];
const PRICE_BUCKETS = [
  { key: '0-100',    en: 'Under $100',     fr: 'Moins de $100',  min: 0,    max: 100 },
  { key: '100-200',  en: '$100 – $200',    fr: '$100 – $200',    min: 100,  max: 200 },
  { key: '200-300',  en: '$200 – $300',    fr: '$200 – $300',    min: 200,  max: 300 },
  { key: '300-500',  en: '$300 – $500',    fr: '$300 – $500',    min: 300,  max: 500 },
  { key: '500+',     en: 'Over $500',      fr: 'Plus de $500',   min: 500,  max: Infinity },
];

const ACCESSORY_KEYWORDS = [
  'case', 'cover', 'screen protector', 'tempered glass', 'charger', 'cable',
  'usb-c', 'usb c', 'lightning', 'magsafe', 'airpods', 'earbud', 'earphone',
  'headphone', 'power bank', 'holder', 'mount', 'stand', 'adapter',
  'wireless charger', 'sticker', 'skin', 'lens protector', 'cleaning',
  'pop socket', 'popsocket', 'lanyard', 'strap', 'wallet case',
  'replacement battery', 'tool kit', 'screwdriver', 'card', 'sim tray',
];

const NON_PHONE_KEYWORDS = [
  'o-pee-chee', 'platinum violet pixels', 'baseball card', 'trading card',
  'rookie card', 'pokemon', 'pikachu', 'panini',
];

const isHandset = (title: string) => {
  const t = title.toLowerCase();
  if (NON_PHONE_KEYWORDS.some(k => t.includes(k))) return false;
  if (ACCESSORY_KEYWORDS.some(k => t.includes(k))) return false;
  return /\b(iphone|galaxy|pixel|xiaomi|oneplus|huawei|nokia|moto|motorola|sony xperia)\b/i.test(t);
};

const extractStorage = (title: string): string | null => {
  const m = title.match(/\b(\d+)\s*(GB|TB)\b/i);
  if (!m) return null;
  return `${m[1]}${m[2].toUpperCase()}`;
};

const matchesAny = (title: string, needles: string[]) =>
  needles.some(n => title.toLowerCase().includes(n));

interface FilterState {
  storage: Set<string>;
  condition: Set<string>;
  carrier: Set<string>;
  price: Set<string>;
}

const SORT_OPTIONS = [
  { key: 'cheapest', en: 'Cheapest first',  fr: 'Moins cher d\'abord' },
  { key: 'newest',   en: 'Newest',          fr: 'Plus récent' },
  { key: 'popular',  en: 'Popular',         fr: 'Populaires' },
];

export default function PhonesPage() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const isFr = language === 'fr' || language === 'ln';

  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const offsetRef = useRef(0);
  const seenRef = useRef(new Set<string>());

  const [sortKey, setSortKey] = useState<string>('cheapest');
  const [filters, setFilters] = useState<FilterState>({
    storage: new Set(),
    condition: new Set(),
    carrier: new Set(),
    price: new Set(),
  });
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const fetchPhones = useCallback(async (offset: number): Promise<Product[]> => {
    let query = supabase
      .from('catalog_items')
      .select('id, provider, provider_product_id, title, image_url, product_url, price_usd, rating, in_stock, popularity_score, first_seen_at')
      .eq('unified_category', 'phones')
      .eq('is_active', true)
      .eq('is_disallowed', false)
      .gt('price_usd', 0);

    if (sortKey === 'cheapest') {
      query = query.order('price_usd', { ascending: true });
    } else if (sortKey === 'newest') {
      query = query.order('first_seen_at', { ascending: false, nullsFirst: false });
    } else {
      query = query.order('popularity_score', { ascending: false, nullsFirst: false });
    }

    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      console.error('[PhonesPage] DB error:', error);
      return [];
    }
    if (!data || data.length < PAGE_SIZE) setExhausted(true);

    const mapped: Product[] = (data || [])
      .map((it: any) => {
        const id = it.provider_product_id || it.id;
        if (!id || seenRef.current.has(id)) return null;
        if (!isRenderableImageUrl(it.image_url)) return null;
        if (!isHandset(it.title || '')) return null;
        seenRef.current.add(id);
        return {
          id,
          provider: it.provider || 'amazon',
          title: it.title || 'Phone',
          imageUrl: it.image_url,
          priceUsd: Number(it.price_usd) || 0,
          rating: it.rating,
          inStock: it.in_stock !== false,
          productUrl: it.product_url,
        } as Product;
      })
      .filter((p): p is Product => !!p);

    await applyServerPrices(mapped);
    return mapped;
  }, [sortKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setAllProducts([]);
    seenRef.current.clear();
    offsetRef.current = 0;
    setExhausted(false);

    (async () => {
      const first = await fetchPhones(0);
      if (cancelled) return;
      setAllProducts(first);
      offsetRef.current = PAGE_SIZE;
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [fetchPhones]);

  const handleLoadMore = async () => {
    if (loadingMore || exhausted) return;
    setLoadingMore(true);
    const more = await fetchPhones(offsetRef.current);
    setAllProducts(prev => [...prev, ...more]);
    offsetRef.current += PAGE_SIZE;
    setLoadingMore(false);
  };

  const visibleProducts = useMemo(() => {
    return allProducts.filter(p => {
      const t = (p.title || '');

      if (filters.storage.size > 0) {
        const s = extractStorage(t);
        if (!s || !filters.storage.has(s)) return false;
      }
      if (filters.condition.size > 0) {
        const ok = CONDITION_OPTIONS.some(c => filters.condition.has(c.key) && matchesAny(t, c.match));
        if (!ok) return false;
      }
      if (filters.carrier.size > 0) {
        const ok = CARRIER_OPTIONS.some(c => filters.carrier.has(c.key) && matchesAny(t, c.match));
        if (!ok) return false;
      }
      if (filters.price.size > 0) {
        const bucket = PRICE_BUCKETS.find(b => filters.price.has(b.key) && p.priceUsd >= b.min && p.priceUsd < b.max);
        if (!bucket) return false;
      }
      return true;
    });
  }, [allProducts, filters]);

  const toggleFilter = (group: keyof FilterState, key: string) => {
    setFilters(prev => {
      const next = new Set(prev[group]);
      next.has(key) ? next.delete(key) : next.add(key);
      return { ...prev, [group]: next };
    });
  };

  const clearAllFilters = () => setFilters({
    storage: new Set(), condition: new Set(), carrier: new Set(), price: new Set(),
  });

  const activeFilterCount =
    filters.storage.size + filters.condition.size + filters.carrier.size + filters.price.size;

  const FiltersPanel = () => (
    <div className="space-y-6">
      {activeFilterCount > 0 && (
        <button
          onClick={clearAllFilters}
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <X className="h-3 w-3" /> {isFr ? 'Effacer tout' : 'Clear all'} ({activeFilterCount})
        </button>
      )}

      <FilterGroup title={isFr ? 'Stockage' : 'Storage'}>
        {STORAGE_OPTIONS.map(s => (
          <FilterCheckbox
            key={s}
            label={s}
            checked={filters.storage.has(s)}
            onToggle={() => toggleFilter('storage', s)}
          />
        ))}
      </FilterGroup>

      <FilterGroup title={isFr ? 'État' : 'Condition'}>
        {CONDITION_OPTIONS.map(c => (
          <FilterCheckbox
            key={c.key}
            label={isFr ? c.fr : c.en}
            checked={filters.condition.has(c.key)}
            onToggle={() => toggleFilter('condition', c.key)}
          />
        ))}
      </FilterGroup>

      <FilterGroup title={isFr ? 'Opérateur' : 'Carrier'}>
        {CARRIER_OPTIONS.map(c => (
          <FilterCheckbox
            key={c.key}
            label={isFr ? c.fr : c.en}
            checked={filters.carrier.has(c.key)}
            onToggle={() => toggleFilter('carrier', c.key)}
          />
        ))}
      </FilterGroup>

      <FilterGroup title={isFr ? 'Prix' : 'Price'}>
        {PRICE_BUCKETS.map(b => (
          <FilterCheckbox
            key={b.key}
            label={isFr ? b.fr : b.en}
            checked={filters.price.has(b.key)}
            onToggle={() => toggleFilter('price', b.key)}
          />
        ))}
      </FilterGroup>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0f1115] pb-safe-nav">
      <ShopHeader />
      <div className="pt-16 md:pt-20" />

      <section className="px-3 sm:px-6">
        <div className="max-w-6xl mx-auto">
          <div
            className="relative overflow-hidden rounded-2xl sm:rounded-3xl"
            style={{
              background:
                'linear-gradient(135deg, hsl(217 91% 38%) 0%, hsl(217 91% 50%) 50%, hsl(210 85% 45%) 100%)',
            }}
          >
            <div
              aria-hidden
              className="absolute inset-0 opacity-[0.12] pointer-events-none"
              style={{
                backgroundImage:
                  'repeating-linear-gradient(135deg, rgba(255,255,255,0.6) 0 1px, transparent 1px 22px), repeating-linear-gradient(45deg, rgba(255,255,255,0.4) 0 1px, transparent 1px 22px)',
              }}
            />
            <div aria-hidden className="absolute -top-20 -left-16 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
            <div aria-hidden className="absolute -bottom-24 -right-20 w-80 h-80 rounded-full bg-primary/30 blur-3xl" />

            <div className="relative px-6 sm:px-10 py-10 sm:py-14 md:py-16 text-center">
              <button
                onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
                className="absolute top-4 left-4 sm:top-5 sm:left-5 inline-flex items-center gap-1.5 text-white/85 hover:text-white text-sm"
              >
                <ArrowLeft className="h-4 w-4" /> {isFr ? 'Retour' : 'Back'}
              </button>

              <span className="inline-block text-[10px] sm:text-xs uppercase tracking-[0.25em] text-white/85 font-semibold mb-3">
                iPhone
              </span>
              <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold text-white tracking-tight leading-[1.05]">
                {isFr ? 'Qualité.' : 'Quality.'}
              </h1>
              <p className="mt-2 sm:mt-3 text-xl sm:text-3xl md:text-4xl font-light text-white/95 tracking-tight leading-tight">
                {isFr ? 'À prix abordable.' : 'Meets affordability.'}
              </p>
              <p className="mt-4 text-sm sm:text-base text-white/80 max-w-xl mx-auto">
                {isFr
                  ? 'Téléphones reconditionnés et neufs — testés, vérifiés, livrés.'
                  : 'Refurbished & new phones — tested, verified, delivered.'}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mt-5 sm:mt-6 mb-6 sm:mb-8">
            {[
              { Icon: Truck,       en: 'Shipping to DRC',       fr: 'Livraison RDC' },
              { Icon: ShieldCheck, en: 'Verified & tested',     fr: 'Vérifié & testé' },
              { Icon: Headphones,  en: '7-Day support',         fr: 'Support 7j/7' },
              { Icon: RotateCcw,   en: 'Return guarantee',      fr: 'Garantie retour' },
            ].map(({ Icon, en, fr }) => (
              <div
                key={en}
                className="flex items-center gap-2 sm:gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 sm:py-3"
              >
                <Icon className="h-4 w-4 sm:h-5 sm:w-5 text-primary flex-shrink-0" />
                <span className="text-[11px] sm:text-[13px] font-medium text-white/85 leading-tight">
                  {isFr ? fr : en}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <main className="px-3 sm:px-6 pb-8">
        <div className="max-w-6xl mx-auto flex gap-6">
          <aside className="hidden lg:block w-60 flex-shrink-0">
            <div className="sticky top-24 rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <h2 className="text-sm font-semibold text-white mb-4">
                {isFr ? 'Filtres' : 'Filters'}
              </h2>
              <FiltersPanel />
            </div>
          </aside>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
                  <SheetTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="lg:hidden border-white/15 bg-transparent text-white/90 hover:bg-white/5 h-9"
                    >
                      <FilterIcon className="h-4 w-4 mr-1.5" />
                      {isFr ? 'Filtres' : 'Filter'}
                      {activeFilterCount > 0 && (
                        <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold w-5 h-5">
                          {activeFilterCount}
                        </span>
                      )}
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-[300px] sm:w-[340px] bg-[#0f1115] border-white/10 overflow-y-auto">
                    <SheetTitle className="text-white text-base mb-4">
                      {isFr ? 'Filtres' : 'Filters'}
                    </SheetTitle>
                    <FiltersPanel />
                    <Button
                      onClick={() => setMobileFiltersOpen(false)}
                      className="w-full mt-6"
                    >
                      {isFr ? 'Voir' : 'Show'} {visibleProducts.length} {isFr ? 'résultats' : 'results'}
                    </Button>
                  </SheetContent>
                </Sheet>

                <span className="text-xs sm:text-sm text-white/50">
                  {visibleProducts.length.toLocaleString()} {isFr ? 'téléphones' : 'phones'}
                </span>
              </div>

              <Select value={sortKey} onValueChange={setSortKey}>
                <SelectTrigger className="w-[160px] sm:w-[180px] bg-transparent border border-white/15 text-white/90 hover:bg-white/5 h-9 text-xs sm:text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-black border border-white/20 z-[9999]">
                  {SORT_OPTIONS.map(o => (
                    <SelectItem
                      key={o.key}
                      value={o.key}
                      className="text-white hover:bg-white/10 focus:bg-white/10 focus:text-white cursor-pointer"
                    >
                      {isFr ? o.fr : o.en}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {loading ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="bg-[#1a1d23] border border-white/[0.08] rounded-xl p-3 animate-pulse">
                    <div className="aspect-square bg-white/[0.06] rounded-lg mb-2" />
                    <div className="h-3 w-3/4 bg-white/[0.06] rounded mb-1" />
                    <div className="h-3 w-1/2 bg-white/[0.06] rounded" />
                  </div>
                ))}
              </div>
            ) : visibleProducts.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-white/60 text-sm mb-3">
                  {isFr ? 'Aucun téléphone ne correspond à vos filtres.' : 'No phones match your filters.'}
                </p>
                {activeFilterCount > 0 && (
                  <Button variant="outline" onClick={clearAllFilters} className="border-white/20 text-white/90 hover:bg-white/10">
                    {isFr ? 'Effacer les filtres' : 'Clear filters'}
                  </Button>
                )}
              </div>
            ) : (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                  {visibleProducts.map(p => (
                    <ProductCard key={`${p.provider}-${p.id}`} product={p} />
                  ))}
                </div>

                {!exhausted && (
                  <div className="flex justify-center mt-8">
                    <Button
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      variant="outline"
                      size="lg"
                      className="border-white/20 bg-white/[0.04] text-white/90 hover:bg-white/[0.08] rounded-full px-8"
                    >
                      {loadingMore ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      {isFr ? 'Afficher plus' : 'Show more'}
                    </Button>
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </div>
      </main>

      <ShopFooter />
      <BottomNavigation />
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-white/5 pb-4 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between mb-2 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-white/70">{title}</span>
        <ChevronDown className={`h-4 w-4 text-white/40 transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="space-y-1.5">{children}</div>}
    </div>
  );
}

function FilterCheckbox({ label, checked, onToggle }: { label: string; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer text-sm text-white/80 hover:text-white py-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="h-4 w-4 rounded border-white/20 bg-white/5 accent-primary cursor-pointer"
      />
      <span>{label}</span>
    </label>
  );
}
