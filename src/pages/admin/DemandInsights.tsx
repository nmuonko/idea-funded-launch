import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, ShoppingCart, TrendingUp } from 'lucide-react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

type RangeOption = '7' | '30' | '90';

interface SearchRow { term: string; count: number; category: string | null }
interface OrderedRow { title: string; store: string | null; image: string | null; totalQty: number; orderCount: number }

export default function DemandInsights() {
  const { language } = useLanguage();
  const t = getAdminTranslation(language);
  const [range, setRange] = useState<RangeOption>('30');
  const [searches, setSearches] = useState<SearchRow[]>([]);
  const [ordered, setOrdered] = useState<OrderedRow[]>([]);
  const [loadingSearches, setLoadingSearches] = useState(true);
  const [loadingOrdered, setLoadingOrdered] = useState(true);

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
        .select('q_norm, category_guess')
        .gte('created_at', since());

      if (!error && data) {
        const map = new Map<string, { count: number; category: string | null }>();
        data.forEach((r: any) => {
          const key = (r.q_norm || '').toLowerCase().trim();
          if (!key) return;
          const prev = map.get(key);
          map.set(key, { count: (prev?.count || 0) + 1, category: prev?.category || r.category_guess });
        });
        const rows = Array.from(map.entries())
          .map(([term, v]) => ({ term, count: v.count, category: v.category }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 20);
        setSearches(rows);
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
        const rows = Array.from(map.values())
          .sort((a, b) => b.totalQty - a.totalQty)
          .slice(0, 20);
        setOrdered(rows);
      }
      setLoadingOrdered(false);
    };

    fetchSearches();
    fetchOrdered();
  }, [range]);

  const rangeLabel = range === '7'
    ? (language === 'fr' ? '7 derniers jours' : 'Last 7 days')
    : range === '30'
    ? (language === 'fr' ? '30 derniers jours' : 'Last 30 days')
    : (language === 'fr' ? '90 derniers jours' : 'Last 90 days');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-primary" />
            {language === 'fr' ? 'Demand Insights' : 'Demand Insights'}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {language === 'fr'
              ? 'Identifiez les produits les plus recherchés et commandés pour vos campagnes.'
              : 'Identify the most searched and ordered products to power your campaigns.'}
          </p>
        </div>
        <ToggleGroup type="single" value={range} onValueChange={(v) => v && setRange(v as RangeOption)} className="border rounded-md">
          <ToggleGroupItem value="7" className="px-3 text-xs">7d</ToggleGroupItem>
          <ToggleGroupItem value="30" className="px-3 text-xs">30d</ToggleGroupItem>
          <ToggleGroupItem value="90" className="px-3 text-xs">90d</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Searches */}
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
                    <TableHead>{language === 'fr' ? 'Catégorie' : 'Category'}</TableHead>
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
                      <TableCell className="text-xs text-muted-foreground">{s.category || '—'}</TableCell>
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
    </div>
  );
}
