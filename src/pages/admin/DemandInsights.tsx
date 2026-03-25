import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, ShoppingCart, TrendingUp, AlertTriangle, BarChart3, Package, Target } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Progress } from '@/components/ui/progress';

type RangeOption = '7' | '30' | '90';

interface SearchRow { term: string; count: number; category: string | null; avgDbCount: number; avgLiveCount: number; signal: string }
interface OrderedRow { title: string; store: string | null; image: string | null; totalQty: number; orderCount: number }
interface CategoryHealth { category: string; items: number; avgPrice: number; minPrice: number; maxPrice: number }
interface SupplyGap { term: string; searches: number; avgSupply: number }

export default function DemandInsights() {
  const { language } = useLanguage();
  const t = getAdminTranslation(language);
  const [range, setRange] = useState<RangeOption>('30');
  const [searches, setSearches] = useState<SearchRow[]>([]);
  const [ordered, setOrdered] = useState<OrderedRow[]>([]);
  const [categories, setCategories] = useState<CategoryHealth[]>([]);
  const [supplyGaps, setSupplyGaps] = useState<SupplyGap[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [loadingSearches, setLoadingSearches] = useState(true);
  const [loadingOrdered, setLoadingOrdered] = useState(true);
  const [loadingCategories, setLoadingCategories] = useState(true);

  const since = () => {
    const d = new Date();
    d.setDate(d.getDate() - Number(range));
    return d.toISOString();
  };

  useEffect(() => {
    const fetchSearches = async () => {
      setLoadingSearches(true);
      const { data, error } = await supabase
        .from('search_query_log')
        .select('q_norm, category_guess, db_count, live_count')
        .gte('created_at', since());

      if (!error && data) {
        const map = new Map<string, { count: number; category: string | null; dbCounts: number[]; liveCounts: number[] }>();
        data.forEach((r: any) => {
          const key = (r.q_norm || '').toLowerCase().trim();
          if (!key || key.length < 2) return;
          const prev = map.get(key);
          const dbCounts = prev?.dbCounts || [];
          const liveCounts = prev?.liveCounts || [];
          dbCounts.push(r.db_count || 0);
          liveCounts.push(r.live_count || 0);
          map.set(key, { count: (prev?.count || 0) + 1, category: prev?.category || r.category_guess, dbCounts, liveCounts });
        });

        const allRows = Array.from(map.entries()).map(([term, v]) => {
          const avgDb = Math.round(v.dbCounts.reduce((a, b) => a + b, 0) / v.dbCounts.length);
          const avgLive = Math.round(v.liveCounts.reduce((a, b) => a + b, 0) / v.liveCounts.length);
          let signal = 'normal';
          if (avgDb < 10 && v.count >= 3) signal = 'gap';
          else if (v.count >= 5) signal = 'hot';
          return { term, count: v.count, category: v.category, avgDbCount: avgDb, avgLiveCount: avgLive, signal };
        });

        // Top searches
        setSearches(allRows.sort((a, b) => b.count - a.count).slice(0, 25));
        // Supply gaps (high search, low supply)
        setSupplyGaps(
          allRows
            .filter(r => r.signal === 'gap' && r.count >= 2)
            .sort((a, b) => b.searches - a.searches || a.avgDbCount - b.avgDbCount)
            .map(r => ({ term: r.term, searches: r.count, avgSupply: r.avgDbCount }))
            .slice(0, 15)
        );
      }
      setLoadingSearches(false);
    };

    const fetchOrdered = async () => {
      setLoadingOrdered(true);
      const { data, error } = await supabase
        .from('order_items')
        .select('title, quantity, store, product_image_url, orders!inner(status, created_at)')
        .neq('orders.status', 'DRAFT')
        .gte('orders.created_at', since());

      if (!error && data) {
        const map = new Map<string, OrderedRow>();
        data.forEach((r: any) => {
          const key = (r.title || 'Unknown').trim();
          const prev = map.get(key);
          map.set(key, {
            title: key,
            store: prev?.store || r.store,
            image: prev?.image || r.product_image_url,
            totalQty: (prev?.totalQty || 0) + (r.quantity || 1),
            orderCount: (prev?.orderCount || 0) + 1,
          });
        });
        setOrdered(Array.from(map.values()).sort((a, b) => b.totalQty - a.totalQty).slice(0, 20));
      }
      setLoadingOrdered(false);
    };

    const fetchCategories = async () => {
      setLoadingCategories(true);
      // Fetch category counts from catalog_items
      const { data, error } = await supabase
        .from('catalog_items')
        .select('unified_category, price_usd')
        .eq('is_active', true)
        .not('unified_category', 'is', null)
        .limit(1000);

      if (!error && data) {
        const map = new Map<string, { count: number; prices: number[] }>();
        data.forEach((r: any) => {
          const cat = r.unified_category || 'uncategorized';
          const prev = map.get(cat) || { count: 0, prices: [] };
          prev.count++;
          if (r.price_usd > 0) prev.prices.push(r.price_usd);
          map.set(cat, prev);
        });
        const rows = Array.from(map.entries())
          .map(([category, v]) => ({
            category,
            items: v.count,
            avgPrice: v.prices.length ? Math.round(v.prices.reduce((a, b) => a + b, 0) / v.prices.length) : 0,
            minPrice: v.prices.length ? Math.round(Math.min(...v.prices)) : 0,
            maxPrice: v.prices.length ? Math.round(Math.max(...v.prices)) : 0,
          }))
          .sort((a, b) => b.items - a.items)
          .slice(0, 15);
        setCategories(rows);
        setTotalItems(rows.reduce((sum, r) => sum + r.items, 0));
      }
      setLoadingCategories(false);
    };

    fetchSearches();
    fetchOrdered();
    fetchCategories();
  }, [range]);

  const rangeLabel = range === '7'
    ? (language === 'fr' ? '7 derniers jours' : 'Last 7 days')
    : range === '30'
    ? (language === 'fr' ? '30 derniers jours' : 'Last 30 days')
    : (language === 'fr' ? '90 derniers jours' : 'Last 90 days');

  const getSignalBadge = (signal: string) => {
    if (signal === 'hot') return <Badge className="bg-orange-500/15 text-orange-600 border-orange-200 text-[10px]">🔥 HOT</Badge>;
    if (signal === 'gap') return <Badge className="bg-red-500/15 text-red-600 border-red-200 text-[10px]">⚠️ GAP</Badge>;
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            {language === 'fr' ? 'Marketing Intelligence' : 'Marketing Intelligence'}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {language === 'fr'
              ? 'Données en temps réel pour piloter vos campagnes et identifier les opportunités.'
              : 'Real-time data to drive your campaigns and identify opportunities.'}
          </p>
        </div>
        <ToggleGroup type="single" value={range} onValueChange={(v) => v && setRange(v as RangeOption)} className="border rounded-md">
          <ToggleGroupItem value="7" className="px-3 text-xs">7d</ToggleGroupItem>
          <ToggleGroupItem value="30" className="px-3 text-xs">30d</ToggleGroupItem>
          <ToggleGroupItem value="90" className="px-3 text-xs">90d</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Search className="h-3.5 w-3.5" />
              {language === 'fr' ? 'Recherches uniques' : 'Unique Searches'}
            </div>
            <div className="text-2xl font-bold">{searches.length}</div>
            <p className="text-[10px] text-muted-foreground mt-1">{rangeLabel}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
              {language === 'fr' ? 'Ruptures de stock' : 'Supply Gaps'}
            </div>
            <div className="text-2xl font-bold text-red-600">{supplyGaps.length}</div>
            <p className="text-[10px] text-muted-foreground mt-1">{language === 'fr' ? 'Forte demande, faible offre' : 'High demand, low supply'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <ShoppingCart className="h-3.5 w-3.5" />
              {language === 'fr' ? 'Produits commandés' : 'Products Ordered'}
            </div>
            <div className="text-2xl font-bold">{ordered.length}</div>
            <p className="text-[10px] text-muted-foreground mt-1">{rangeLabel}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Package className="h-3.5 w-3.5" />
              {language === 'fr' ? 'Catalogue actif' : 'Active Catalog'}
            </div>
            <div className="text-2xl font-bold">{totalItems > 1000 ? `${Math.round(totalItems / 1000)}K` : totalItems}</div>
            <p className="text-[10px] text-muted-foreground mt-1">{language === 'fr' ? 'Échantillon actif' : 'Active sample'}</p>
          </CardContent>
        </Card>
      </div>

      {/* Supply Gaps - Critical for marketing strategy */}
      {supplyGaps.length > 0 && (
        <Card className="border-red-200 bg-red-50/30 dark:bg-red-950/10">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-red-700 dark:text-red-400">
              <Target className="h-4 w-4" />
              {language === 'fr' ? '🎯 Opportunités — Forte demande, faible offre' : '🎯 Opportunities — High Demand, Low Supply'}
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              {language === 'fr'
                ? 'Termes recherchés fréquemment mais peu/pas de produits en catalogue. Ajoutez ces produits pour capturer la demande.'
                : 'Frequently searched terms with little or no catalog supply. Add these products to capture demand.'}
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {supplyGaps.map((g) => (
                <Badge key={g.term} variant="outline" className="bg-background px-3 py-1.5 text-sm border-red-200">
                  <span className="font-medium">{g.term}</span>
                  <span className="ml-2 text-muted-foreground text-xs">({g.searches}×)</span>
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Searches with signals */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4" />
              {language === 'fr' ? 'Recherches populaires' : 'Top Searches'}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{rangeLabel}</p>
          </CardHeader>
          <CardContent>
            {loadingSearches ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : searches.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {language === 'fr' ? 'Aucune donnée' : 'No search data'}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>{language === 'fr' ? 'Terme' : 'Term'}</TableHead>
                    <TableHead className="text-right">{language === 'fr' ? 'Recherches' : 'Searches'}</TableHead>
                    <TableHead className="text-right">{language === 'fr' ? 'Stock DB' : 'DB Supply'}</TableHead>
                    <TableHead>{language === 'fr' ? 'Signal' : 'Signal'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {searches.map((s, i) => (
                    <TableRow key={s.term}>
                      <TableCell className="font-medium text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-medium">{s.term}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary">{s.count}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">{s.avgDbCount}</TableCell>
                      <TableCell>{getSignalBadge(s.signal)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Most Ordered */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingCart className="h-4 w-4" />
              {language === 'fr' ? 'Produits les plus commandés' : 'Most Ordered Items'}
            </CardTitle>
            <p className="text-xs text-muted-foreground">{rangeLabel}</p>
          </CardHeader>
          <CardContent>
            {loadingOrdered ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : ordered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                {language === 'fr' ? 'Aucune donnée' : 'No order data'}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>{language === 'fr' ? 'Produit' : 'Product'}</TableHead>
                    <TableHead>{language === 'fr' ? 'Source' : 'Source'}</TableHead>
                    <TableHead className="text-right">{language === 'fr' ? 'Qté' : 'Qty'}</TableHead>
                    <TableHead className="text-right">{language === 'fr' ? 'Commandes' : 'Orders'}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ordered.map((o, i) => (
                    <TableRow key={o.title}>
                      <TableCell className="font-medium text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {o.image && (
                            <img src={o.image} alt="" className="h-8 w-8 rounded object-cover" />
                          )}
                          <span className="font-medium text-sm line-clamp-1">{o.title}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {o.store && <Badge variant="outline" className="text-xs">{o.store}</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary">{o.totalQty}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">{o.orderCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Category Health */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4" />
            {language === 'fr' ? 'Santé du catalogue par catégorie' : 'Catalog Health by Category'}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {language === 'fr' ? 'Répartition des articles actifs et fourchettes de prix' : 'Active item distribution and price ranges'}
          </p>
        </CardHeader>
        <CardContent>
          {loadingCategories ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-3">
              {categories.map((cat) => {
                const pct = totalItems > 0 ? Math.round((cat.items / totalItems) * 100) : 0;
                return (
                  <div key={cat.category} className="flex items-center gap-3">
                    <div className="w-36 text-sm font-medium truncate">{cat.category || 'uncategorized'}</div>
                    <div className="flex-1">
                      <Progress value={pct} className="h-2" />
                    </div>
                    <div className="w-16 text-right text-xs text-muted-foreground">{cat.items}</div>
                    <div className="w-32 text-right text-[10px] text-muted-foreground">
                      ${cat.minPrice} — ${cat.maxPrice}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
