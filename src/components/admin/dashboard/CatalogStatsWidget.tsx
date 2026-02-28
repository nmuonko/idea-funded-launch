import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Database, DollarSign, Layers, Tag, ShoppingBag, BarChart3, Clock, ArrowDown, ArrowUp, Sigma } from 'lucide-react';
import { formatUSD } from '@/lib/formatCurrency';

interface CatalogStats {
  totalProducts: number;
  activeProducts: number;
  disallowedProducts: number;
  totalValue: number;
  avgPrice: number;
  cheapestPrice: number | null;
  mostExpensivePrice: number | null;
  providerBreakdown: { provider: string; count: number }[];
  categoryBreakdown: { category: string; count: number }[];
  recentlyAdded24h: number;
  oldestItem: string | null;
  newestItem: string | null;
}

async function loadCatalogStats(): Promise<CatalogStats> {
  const [
    totalRes,
    activeRes,
    disallowedRes,
    breakdownRes,
    priceStatsRes,
    recentRes,
    oldestRes,
    newestRes,
    cheapestRes,
    expensiveRes,
  ] = await Promise.all([
    supabase.from('catalog_items').select('id', { count: 'exact', head: true }),
    supabase.from('catalog_items').select('id', { count: 'exact', head: true })
      .eq('is_active', true).eq('is_disallowed', false),
    supabase.from('catalog_items').select('id', { count: 'exact', head: true })
      .eq('is_disallowed', true),
    supabase.from('catalog_items')
      .select('provider, unified_category')
      .eq('is_active', true).eq('is_disallowed', false)
      .not('price_usd', 'is', null).gt('price_usd', 0)
      .limit(1000),
    // Accurate total value + avg via RPC (no row limit)
    supabase.rpc('get_catalog_price_stats') as unknown as { data: { total_value: number; avg_price: number }[] | null },
    supabase.from('catalog_items').select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .gte('first_seen_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    supabase.from('catalog_items').select('first_seen_at')
      .eq('is_active', true).not('first_seen_at', 'is', null)
      .order('first_seen_at', { ascending: true }).limit(1),
    supabase.from('catalog_items').select('first_seen_at')
      .eq('is_active', true).not('first_seen_at', 'is', null)
      .order('first_seen_at', { ascending: false }).limit(1),
    supabase.from('catalog_items').select('price_usd')
      .eq('is_active', true).eq('is_disallowed', false)
      .not('price_usd', 'is', null).gt('price_usd', 0)
      .order('price_usd', { ascending: true }).limit(1),
    supabase.from('catalog_items').select('price_usd')
      .eq('is_active', true).eq('is_disallowed', false)
      .not('price_usd', 'is', null).gt('price_usd', 0)
      .order('price_usd', { ascending: false }).limit(1),
  ]);

  const totalProducts = totalRes.count || 0;
  const activeProducts = activeRes.count || 0;
  const disallowedProducts = disallowedRes.count || 0;
  const recentlyAdded24h = recentRes.count || 0;

  // Accurate values from DB-side aggregation
  const priceStats = priceStatsRes.data?.[0];
  const totalValue = Number(priceStats?.total_value ?? 0);
  const avgPrice = Number(priceStats?.avg_price ?? 0);

  const breakdownData = breakdownRes.data || [];
  const providerMap = new Map<string, number>();
  breakdownData.forEach(item => {
    const p = item.provider || 'unknown';
    providerMap.set(p, (providerMap.get(p) || 0) + 1);
  });
  const providerBreakdown = Array.from(providerMap.entries())
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => b.count - a.count);

  const catMap = new Map<string, number>();
  breakdownData.forEach(item => {
    const c = item.unified_category || 'uncategorized';
    catMap.set(c, (catMap.get(c) || 0) + 1);
  });
  const categoryBreakdown = Array.from(catMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const oldestItem = oldestRes.data?.[0]?.first_seen_at || null;
  const newestItem = newestRes.data?.[0]?.first_seen_at || null;
  const cheapestPrice = cheapestRes.data?.[0]?.price_usd ?? null;
  const mostExpensivePrice = expensiveRes.data?.[0]?.price_usd ?? null;

  return {
    totalProducts, activeProducts, disallowedProducts,
    totalValue, avgPrice, cheapestPrice, mostExpensivePrice,
    providerBreakdown, categoryBreakdown,
    recentlyAdded24h, oldestItem, newestItem,
  };
}

function StatRow({ icon: Icon, label, value, subValue }: {
  icon: typeof Database;
  label: string;
  value: string | number;
  subValue?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border/30 last:border-0">
      <div className="flex items-center gap-2.5">
        <div className="p-1.5 rounded-md bg-primary/10">
          <Icon className="h-3.5 w-3.5 text-primary" />
        </div>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="text-right">
        <span className="text-sm font-semibold">{value}</span>
        {subValue && (
          <span className="text-xs text-muted-foreground ml-1.5">{subValue}</span>
        )}
      </div>
    </div>
  );
}

function ProviderBar({ provider, count, maxCount }: { provider: string; count: number; maxCount: number }) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  const colors: Record<string, string> = {
    ebay: 'bg-blue-500',
    amazon: 'bg-amber-500',
    rainforest: 'bg-amber-500',
    shein: 'bg-pink-500',
    cargurus: 'bg-emerald-500',
    carvana: 'bg-cyan-500',
  };
  const barColor = colors[provider] || 'bg-primary';
  const displayName = provider === 'rainforest' ? 'Amazon' : provider.charAt(0).toUpperCase() + provider.slice(1);

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-16 truncate">{displayName}</span>
      <div className="flex-1 h-2.5 rounded-full bg-muted/50 overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium w-12 text-right">{count.toLocaleString()}</span>
    </div>
  );
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function CatalogStatsTab({ embedded }: { embedded?: boolean }) {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin', 'catalog-stats'],
    queryFn: loadCatalogStats,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const maxProviderCount = Math.max(...stats.providerBreakdown.map(p => p.count), 1);

  return (
    <div className="space-y-6">
      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="rounded-lg border border-border/40 bg-muted/20 p-4 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Layers className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Total</span>
          </div>
          <p className="text-2xl font-bold">{stats.totalProducts.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-border/40 bg-muted/20 p-4 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <ShoppingBag className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Active</span>
          </div>
          <p className="text-2xl font-bold">{stats.activeProducts.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-border/40 bg-muted/20 p-4 space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground">
            <BarChart3 className="h-4 w-4" />
            <span className="text-xs font-medium uppercase tracking-wide">New (24h)</span>
          </div>
          <p className="text-2xl font-bold text-emerald-500">+{stats.recentlyAdded24h.toLocaleString()}</p>
        </div>
      </div>

      {/* Detail rows */}
      <div className="rounded-lg border border-border/40 bg-card/30 px-4">
        <StatRow icon={Sigma} label="Total Catalog Value" value={formatUSD(stats.totalValue)} />
        <StatRow icon={ArrowDown} label="Cheapest Item" value={stats.cheapestPrice !== null ? formatUSD(stats.cheapestPrice) : '—'} />
        <StatRow icon={ArrowUp} label="Most Expensive" value={stats.mostExpensivePrice !== null ? formatUSD(stats.mostExpensivePrice) : '—'} />
        <StatRow icon={Tag} label="Average Price" value={formatUSD(stats.avgPrice)} />
        <StatRow icon={Database} label="Disallowed / Blocked" value={stats.disallowedProducts.toLocaleString()} />
        <StatRow icon={Clock} label="Oldest Item" value={formatDate(stats.oldestItem)} />
        <StatRow icon={Clock} label="Newest Item" value={formatDate(stats.newestItem)} />
      </div>

      {/* Provider + Category side by side */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Provider breakdown */}
        {stats.providerBreakdown.length > 0 && (
          <div className="rounded-lg border border-border/40 bg-card/30 p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">By Provider</p>
            <div className="space-y-2.5">
              {stats.providerBreakdown.map(p => (
                <ProviderBar key={p.provider} provider={p.provider} count={p.count} maxCount={maxProviderCount} />
              ))}
            </div>
          </div>
        )}

        {/* Top categories */}
        {stats.categoryBreakdown.length > 0 && (
          <div className="rounded-lg border border-border/40 bg-card/30 p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Top Categories</p>
            <div className="flex flex-wrap gap-2">
              {stats.categoryBreakdown.map(c => (
                <span key={c.category} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/60 text-xs">
                  <span className="text-muted-foreground capitalize">{c.category.replace(/_/g, ' ')}</span>
                  <span className="font-semibold">{c.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
