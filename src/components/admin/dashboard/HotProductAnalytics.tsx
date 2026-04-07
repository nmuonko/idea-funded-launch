import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Flame, Eye, MousePointer, ShoppingCart, TrendingUp, BarChart3 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

interface ProductStats {
  provider_product_id: string;
  provider: string;
  title: string;
  image_url: string;
  views: number;
  clicks: number;
  buy_clicks: number;
  ctr: number; // click-through rate
  conversion: number; // buy/view
}

async function fetchHotProductAnalytics(days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [clicksRes, showcaseRes] = await Promise.all([
    supabase
      .from('hot_product_clicks')
      .select('provider_product_id, provider, event_type, source, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('hot_products_showcase')
      .select('provider_product_id, provider, title, image_url')
      .eq('is_active', true),
  ]);

  if (clicksRes.error) console.error('[HotProductAnalytics] clicks error:', clicksRes.error);
  if (showcaseRes.error) console.error('[HotProductAnalytics] showcase error:', showcaseRes.error);

  const clicks = (clicksRes.data || []) as any[];
  const showcase = (showcaseRes.data || []) as any[];
  const showcaseMap = new Map(showcase.map((s: any) => [`${s.provider}:${s.provider_product_id}`, s]));

  // Aggregate
  const statsMap = new Map<string, { views: number; clicks: number; buy_clicks: number; web: number; mobile: number }>();
  for (const c of clicks) {
    const key = `${c.provider}:${c.provider_product_id}`;
    if (!statsMap.has(key)) statsMap.set(key, { views: 0, clicks: 0, buy_clicks: 0, web: 0, mobile: 0 });
    const s = statsMap.get(key)!;
    if (c.event_type === 'view') s.views++;
    else if (c.event_type === 'click') s.clicks++;
    else if (c.event_type === 'buy_now') s.buy_clicks++;
    if (c.source === 'web') s.web++;
    else s.mobile++;
  }

  const results: ProductStats[] = [];
  for (const [key, s] of statsMap) {
    const info = showcaseMap.get(key);
    results.push({
      provider_product_id: key.split(':')[1],
      provider: key.split(':')[0],
      title: info?.title || key,
      image_url: info?.image_url || '',
      views: s.views,
      clicks: s.clicks,
      buy_clicks: s.buy_clicks,
      ctr: s.views > 0 ? Math.round((s.clicks / s.views) * 1000) / 10 : 0,
      conversion: s.views > 0 ? Math.round((s.buy_clicks / s.views) * 1000) / 10 : 0,
    });
  }

  // Sort by total engagement
  results.sort((a, b) => (b.views + b.clicks + b.buy_clicks) - (a.views + a.clicks + a.buy_clicks));

  // Totals
  const totals = {
    totalViews: clicks.filter(c => c.event_type === 'view').length,
    totalClicks: clicks.filter(c => c.event_type === 'click').length,
    totalBuyClicks: clicks.filter(c => c.event_type === 'buy_now').length,
    webTraffic: clicks.filter(c => c.source === 'web').length,
    mobileTraffic: clicks.filter(c => c.source === 'mobile').length,
  };

  return { products: results, totals };
}

export function HotProductAnalytics() {
  const [period, setPeriod] = useState<'7' | '30' | '90'>('7');
  const days = parseInt(period);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'hot-product-analytics', period],
    queryFn: () => fetchHotProductAnalytics(days),
    staleTime: 60_000,
  });

  const totals = data?.totals || { totalViews: 0, totalClicks: 0, totalBuyClicks: 0, webTraffic: 0, mobileTraffic: 0 };
  const products = data?.products || [];

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-orange-500" />
          Hot Products Analytics
        </h3>
        <Tabs value={period} onValueChange={(v) => setPeriod(v as any)}>
          <TabsList className="h-8">
            <TabsTrigger value="7" className="text-xs px-3 h-7">7 days</TabsTrigger>
            <TabsTrigger value="30" className="text-xs px-3 h-7">30 days</TabsTrigger>
            <TabsTrigger value="90" className="text-xs px-3 h-7">90 days</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <Eye className="h-3.5 w-3.5" /> Page Views
            </div>
            <p className="text-2xl font-bold">{isLoading ? '...' : totals.totalViews.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <MousePointer className="h-3.5 w-3.5" /> Product Clicks
            </div>
            <p className="text-2xl font-bold">{isLoading ? '...' : totals.totalClicks.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <ShoppingCart className="h-3.5 w-3.5" /> Buy Now Clicks
            </div>
            <p className="text-2xl font-bold text-emerald-500">{isLoading ? '...' : totals.totalBuyClicks.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
              <TrendingUp className="h-3.5 w-3.5" /> Conversion
            </div>
            <p className="text-2xl font-bold">
              {isLoading ? '...' : totals.totalViews > 0 ? `${Math.round((totals.totalBuyClicks / totals.totalViews) * 1000) / 10}%` : '0%'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Product ranking table */}
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-500" />
            Product Performance Ranking
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground text-sm">Loading analytics...</div>
          ) : products.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No data yet. Clicks will appear here once customers interact with hot products.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-center">Views</TableHead>
                  <TableHead className="text-center">Clicks</TableHead>
                  <TableHead className="text-center">Buy Clicks</TableHead>
                  <TableHead className="text-center">CTR</TableHead>
                  <TableHead className="text-center">Conv.</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p, i) => (
                  <TableRow key={`${p.provider}-${p.provider_product_id}`}>
                    <TableCell className="font-bold text-muted-foreground">{i + 1}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {p.image_url && (
                          <img src={p.image_url} alt="" className="w-8 h-8 rounded object-contain bg-white flex-shrink-0" />
                        )}
                        <span className="text-xs line-clamp-2 max-w-[200px]">{p.title}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center font-mono text-sm">{p.views}</TableCell>
                    <TableCell className="text-center font-mono text-sm">{p.clicks}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={p.buy_clicks > 0 ? 'default' : 'secondary'} className="text-xs">
                        {p.buy_clicks}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center text-xs">{p.ctr}%</TableCell>
                    <TableCell className="text-center">
                      <Badge variant={p.conversion > 0 ? 'default' : 'outline'} className={`text-xs ${p.conversion >= 5 ? 'bg-emerald-500' : ''}`}>
                        {p.conversion}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
