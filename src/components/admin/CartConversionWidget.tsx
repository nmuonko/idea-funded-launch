import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { TrendingUp, TrendingDown, ShoppingCart } from 'lucide-react';

interface ConversionMetrics {
  activeCarts: number;
  completedOrders: number;
  conversionRate: number;
  trend: number;
}

export function CartConversionWidget() {
  const [metrics, setMetrics] = useState<ConversionMetrics>({
    activeCarts: 0,
    completedOrders: 0,
    conversionRate: 0,
    trend: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMetrics();
  }, []);

  const loadMetrics = async () => {
    try {
      setLoading(true);

      // Get active carts (DRAFT and PENDING_PAYMENT)
      const { data: activeCarts } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .in('status', ['DRAFT', 'PENDING_PAYMENT']);

      // Get completed orders this month
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const { data: completedThisMonth } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .in('status', ['PAID', 'PROCESSING', 'SHIPPED', 'READY_FOR_PICKUP', 'COMPLETED'])
        .gte('created_at', startOfMonth.toISOString());

      // Get completed orders last month for trend calculation
      const startOfLastMonth = new Date(startOfMonth);
      startOfLastMonth.setMonth(startOfLastMonth.getMonth() - 1);
      const endOfLastMonth = new Date(startOfMonth);
      endOfLastMonth.setSeconds(-1);

      const { data: completedLastMonth } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .in('status', ['PAID', 'PROCESSING', 'SHIPPED', 'READY_FOR_PICKUP', 'COMPLETED'])
        .gte('created_at', startOfLastMonth.toISOString())
        .lte('created_at', endOfLastMonth.toISOString());

      // Get total carts created this month (including converted ones)
      const { data: totalCartsThisMonth } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', startOfMonth.toISOString());

      const activeCount = activeCarts?.length || 0;
      const completedCount = completedThisMonth?.length || 0;
      const totalCarts = totalCartsThisMonth?.length || 0;
      const completedLastMonthCount = completedLastMonth?.length || 0;

      const conversionRate = totalCarts > 0 ? (completedCount / totalCarts) * 100 : 0;
      
      // Calculate trend compared to last month
      const trend = completedLastMonthCount > 0 
        ? ((completedCount - completedLastMonthCount) / completedLastMonthCount) * 100 
        : 0;

      setMetrics({
        activeCarts: activeCount,
        completedOrders: completedCount,
        conversionRate,
        trend,
      });
    } catch (error) {
      console.error('Error loading conversion metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTrendIcon = () => {
    if (metrics.trend > 0) {
      return <TrendingUp className="h-4 w-4 text-emerald-600" />;
    } else if (metrics.trend < 0) {
      return <TrendingDown className="h-4 w-4 text-red-600" />;
    }
    return null;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShoppingCart className="h-5 w-5" />
          Cart Conversion
        </CardTitle>
        <CardDescription>Monthly conversion rate and trends</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-4 text-muted-foreground">Loading metrics...</div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-muted-foreground">Active Carts</div>
                <div className="text-2xl font-bold">{metrics.activeCarts}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Completed (This Month)</div>
                <div className="text-2xl font-bold text-emerald-600">
                  {metrics.completedOrders}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t">
              <div className="text-sm text-muted-foreground mb-1">Conversion Rate</div>
              <div className="flex items-center gap-2">
                <div className="text-3xl font-bold">
                  {metrics.conversionRate.toFixed(1)}%
                </div>
                {getTrendIcon()}
                {metrics.trend !== 0 && (
                  <span className={`text-sm ${metrics.trend > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {metrics.trend > 0 ? '+' : ''}{metrics.trend.toFixed(1)}% vs last month
                  </span>
                )}
              </div>
            </div>

            <div className="pt-4 border-t">
              <div className="text-xs text-muted-foreground">
                Conversion rate: Completed orders / Total carts started this month
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
