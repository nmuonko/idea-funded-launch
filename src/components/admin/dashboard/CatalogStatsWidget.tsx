import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Database, DollarSign, Layers, Tag, ShoppingBag, BarChart3 } from 'lucide-react';
import { formatUSD } from '@/lib/formatCurrency';

interface CatalogStats {
  totalProducts: number;
  activeProducts: number;
  totalValue: number;
  avgPrice: number;
  providerBreakdown: { provider: string; count: number }[];
  categoryBreakdown: { category: string; count: number }[];
  recentlyAdded24h: number;
}

async function loadCatalogStats(): Promise<CatalogStats> {
  // Parallel queries for efficiency
  const [
    totalRes,
    activeRes,
    priceRes,
    recentRes,
  ] = await Promise.all([
    supabase
      .from('catalog_items')
      .select('id', { count: 'exact', head: true }),
    supabase
      .from('catalog_items')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .eq('is_disallowed', false),
    supabase
      .from('catalog_items')
      .select('price_usd, provider, unified_category')
      .eq('is_active', true)
      .eq('is_disallowed', false)
      .not('price_usd', 'is', null)
      .gt('price_usd', 0)
      .limit(1000),
    supabase
      .from('catalog_items')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .gte('first_seen_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  ]);

  const totalProducts = totalRes.count || 0;
  const activeProducts = activeRes.count || 0;
  const recentlyAdded24h = recentRes.count || 0;

  const priceData = priceRes.data || [];
  const totalValue = priceData.reduce((sum, item) => sum + Number(item.price_usd || 0), 0);
  const avgPrice = priceData.length > 0 ? totalValue / priceData.length : 0;

  // Provider breakdown
  const providerMap = new Map<string, number>();
  priceData.forEach(item => {
    const p = item.provider || 'unknown';
    providerMap.set(p, (providerMap.get(p) || 0) + 1);
  });
  const providerBreakdown = Array.from(providerMap.entries())
    .map(([provider, count]) => ({ provider, count }))
    .sort((a, b) => b.count - a.count);

  // Category breakdown (top 6)
  const catMap = new Map<string, number>();
  priceData.forEach(item => {
    const c = item.unified_category || 'uncategorized';
    catMap.set(c, (catMap.get(c) || 0) + 1);
  });
  const categoryBreakdown = Array.from(catMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  return {
    totalProducts,
    activeProducts,
    totalValue,
    avgPrice,
    providerBreakdown,
    categoryBreakdown,
    recentlyAdded24h,
  };
}

function StatRow({ icon: Icon, label, value, subValue }: {
  icon: typeof Database;
  label: string;
  value: string | number;
  subValue?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/30 last:border-0">
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
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-16 truncate">{displayName}</span>
      <div className="flex-1 h-2 rounded-full bg-muted/50 overflow-hidden">
        <div className={`h-full rounded-full ${barColor} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-medium w-10 text-right">{count.toLocaleString()}</span>
    </div>
  );
}

export function CatalogStatsWidget() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['admin', 'catalog-stats'],
    queryFn: loadCatalogStats,
    staleTime: 2 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!stats) return null;

  const maxProviderCount = Math.max(...stats.providerBreakdown.map(p => p.count), 1);

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          Catalog Overview
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        {/* Key metrics */}
        <StatRow icon={Layers} label="Total Products" value={stats.totalProducts.toLocaleString()} />
        <StatRow icon={ShoppingBag} label="Active Products" value={stats.activeProducts.toLocaleString()} />
        <StatRow icon={DollarSign} label="Total Inventory Value" value={formatUSD(stats.totalValue)} subValue="(sampled)" />
        <StatRow icon={Tag} label="Avg Price" value={formatUSD(stats.avgPrice)} />
        <StatRow icon={BarChart3} label="Added (24h)" value={`+${stats.recentlyAdded24h.toLocaleString()}`} />

        {/* Provider breakdown */}
        {stats.providerBreakdown.length > 0 && (
          <div className="pt-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">By Provider</p>
            <div className="space-y-1.5">
              {stats.providerBreakdown.map(p => (
                <ProviderBar key={p.provider} provider={p.provider} count={p.count} maxCount={maxProviderCount} />
              ))}
            </div>
          </div>
        )}

        {/* Top categories */}
        {stats.categoryBreakdown.length > 0 && (
          <div className="pt-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Top Categories</p>
            <div className="flex flex-wrap gap-1.5">
              {stats.categoryBreakdown.map(c => (
                <span key={c.category} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/60 text-xs">
                  <span className="text-muted-foreground">{c.category.replace(/_/g, ' ')}</span>
                  <span className="font-medium">{c.count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
