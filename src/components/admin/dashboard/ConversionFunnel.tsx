import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { Filter, ShoppingCart, XCircle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FunnelData {
  activeCarts: number;
  completedOrders: number;
  abandonedCarts: number;
  conversionRate: number;
}

export function ConversionFunnel() {
  const [data, setData] = useState<FunnelData>({
    activeCarts: 0,
    completedOrders: 0,
    abandonedCarts: 0,
    conversionRate: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFunnelData();
  }, []);

  const loadFunnelData = async () => {
    try {
      const { data: orders, error } = await supabase
        .from('orders')
        .select('status, payment_verified_at, created_at');

      if (error) throw error;

      // Active carts = DRAFT orders
      const activeCarts = orders?.filter(o => o.status === 'DRAFT').length || 0;
      
      // Completed = orders with payment verified
      const completedOrders = orders?.filter(o => o.payment_verified_at).length || 0;
      
      // Abandoned = PENDING_PAYMENT or CANCELLED orders older than 24h
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const abandonedCarts = orders?.filter(o => 
        (o.status === 'PENDING_PAYMENT' || o.status === 'CANCELLED') &&
        new Date(o.created_at) < oneDayAgo
      ).length || 0;
      
      // Total carts created (excluding current DRAFT)
      const totalCheckoutAttempts = orders?.filter(o => o.status !== 'DRAFT').length || 0;
      
      // Conversion rate = completed / total checkout attempts
      const conversionRate = totalCheckoutAttempts > 0 
        ? Math.round((completedOrders / totalCheckoutAttempts) * 100) 
        : 0;

      setData({
        activeCarts,
        completedOrders,
        abandonedCarts,
        conversionRate,
      });
    } catch (error) {
      console.error('Error loading funnel data:', error);
    } finally {
      setLoading(false);
    }
  };

  const metrics = [
    { 
      label: 'Active Carts', 
      value: data.activeCarts, 
      icon: ShoppingCart, 
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
    },
    { 
      label: 'Completed', 
      value: data.completedOrders, 
      icon: CheckCircle, 
      color: 'text-emerald-500',
      bgColor: 'bg-emerald-500/10',
    },
    { 
      label: 'Abandoned', 
      value: data.abandonedCarts, 
      icon: XCircle, 
      color: 'text-red-500',
      bgColor: 'bg-red-500/10',
    },
  ];

  if (loading) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-60 mt-1" />
        </CardHeader>
        <CardContent className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Conversion Funnel</CardTitle>
        </div>
        <CardDescription>Cart to purchase journey</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
          >
            <div className={cn('p-2 rounded-lg', metric.bgColor)}>
              <metric.icon className={cn('h-4 w-4', metric.color)} />
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">{metric.label}</p>
              <p className="text-xl font-bold">{metric.value}</p>
            </div>
          </div>
        ))}
        
        <div className="pt-4 border-t border-border/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Conversion Rate</span>
            <span className={cn(
              'text-lg font-bold',
              data.conversionRate >= 50 ? 'text-emerald-500' : 
              data.conversionRate >= 25 ? 'text-yellow-500' : 'text-red-500'
            )}>
              {data.conversionRate}%
            </span>
          </div>
          <Progress 
            value={data.conversionRate} 
            className="h-2"
          />
        </div>
      </CardContent>
    </Card>
  );
}
