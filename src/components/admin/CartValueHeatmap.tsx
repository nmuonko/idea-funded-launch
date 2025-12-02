import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { TrendingUp, Package } from 'lucide-react';
import { formatUSD } from '@/lib/formatCurrency';

interface CategoryMetrics {
  store: string;
  totalValue: number;
  cartCount: number;
  avgCartValue: number;
  itemCount: number;
}

export default function CartValueHeatmap() {
  const [categoryData, setCategoryData] = useState<CategoryMetrics[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHeatmapData();
  }, []);

  const loadHeatmapData = async () => {
    try {
      setLoading(true);

      // Get all abandoned carts (DRAFT and PENDING_PAYMENT orders)
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select(`
          id,
          total_usd,
          order_items (
            store,
            total_price_usd,
            quantity
          )
        `)
        .in('status', ['DRAFT', 'PENDING_PAYMENT']);

      if (ordersError) throw ordersError;

      // Aggregate by category
      const categoryMap: Record<string, CategoryMetrics> = {};

      (orders || []).forEach((order) => {
        (order.order_items || []).forEach((item: any) => {
          const store = item.store || 'OTHER';
          
          if (!categoryMap[store]) {
            categoryMap[store] = {
              store,
              totalValue: 0,
              cartCount: 0,
              avgCartValue: 0,
              itemCount: 0,
            };
          }

          categoryMap[store].totalValue += Number(item.total_price_usd || 0) * item.quantity;
          categoryMap[store].itemCount += item.quantity;
        });

        // Count unique carts per category
        (order.order_items || []).forEach((item: any) => {
          const store = item.store || 'OTHER';
          if (categoryMap[store]) {
            categoryMap[store].cartCount++;
          }
        });
      });

      // Calculate averages
      const metricsArray = Object.values(categoryMap).map((m) => ({
        ...m,
        avgCartValue: m.cartCount > 0 ? m.totalValue / m.cartCount : 0,
      }));

      // Sort by total value descending
      metricsArray.sort((a, b) => b.totalValue - a.totalValue);

      setCategoryData(metricsArray);
    } catch (error) {
      console.error('Error loading heatmap data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getHeatColor = (value: number, maxValue: number) => {
    const intensity = maxValue > 0 ? (value / maxValue) : 0;
    if (intensity > 0.7) return 'bg-red-600 text-white';
    if (intensity > 0.4) return 'bg-orange-500 text-white';
    if (intensity > 0.2) return 'bg-yellow-500 text-black';
    return 'bg-blue-500 text-white';
  };

  const maxValue = Math.max(...categoryData.map(c => c.totalValue), 1);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          Abandoned Cart Value Heatmap
        </CardTitle>
        <CardDescription>
          Product categories generating highest-value abandoned carts
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading heatmap...</div>
        ) : categoryData.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No abandoned cart data available
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3">
              {categoryData.map((category) => (
                <div
                  key={category.store}
                  className={`p-4 rounded-lg transition-all hover:scale-105 ${getHeatColor(
                    category.totalValue,
                    maxValue
                  )}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-bold text-lg">{category.store}</div>
                    <div className="flex items-center gap-1">
                      <TrendingUp className="h-4 w-4" />
                      <span className="font-bold">{formatUSD(category.totalValue)}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm opacity-90">
                    <div>
                      <div className="font-semibold">{category.cartCount}</div>
                      <div className="text-xs">Carts</div>
                    </div>
                    <div>
                      <div className="font-semibold">{category.itemCount}</div>
                      <div className="text-xs">Items</div>
                    </div>
                    <div>
                      <div className="font-semibold">{formatUSD(category.avgCartValue)}</div>
                      <div className="text-xs">Avg Value</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-4 border-t">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Heat Legend:</span>
                <div className="flex gap-2">
                  <div className="flex items-center gap-1">
                    <div className="w-4 h-4 rounded bg-blue-500" />
                    <span className="text-xs">Low</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-4 h-4 rounded bg-yellow-500" />
                    <span className="text-xs">Medium</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-4 h-4 rounded bg-orange-500" />
                    <span className="text-xs">High</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-4 h-4 rounded bg-red-600" />
                    <span className="text-xs">Highest</span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Focus recovery efforts on red categories with highest abandoned cart values
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}