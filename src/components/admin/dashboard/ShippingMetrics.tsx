import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Truck, Clock, CheckCircle2, Package } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DateRange } from './DateRangeFilter';

interface ShippingData {
  avgShippingDays: number;
  shippedThisWeek: number;
  deliveredThisWeek: number;
  pendingShipment: number;
}

interface ShippingMetricsProps {
  dateRange?: DateRange;
  embedded?: boolean;
}

async function fetchShippingData(): Promise<ShippingData> {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: orders, error } = await supabase
    .from('orders')
    .select('status, shipped_at, delivered_at, payment_verified_at');

  if (error) throw error;

  const shippedThisWeek = orders?.filter(o =>
    o.shipped_at && new Date(o.shipped_at) >= new Date(oneWeekAgo)
  ).length || 0;

  const deliveredThisWeek = orders?.filter(o =>
    o.delivered_at && new Date(o.delivered_at) >= new Date(oneWeekAgo)
  ).length || 0;

  const pendingShipment = orders?.filter(o =>
    o.payment_verified_at && !o.shipped_at &&
    (o.status === 'PAID' || o.status === 'PROCESSING')
  ).length || 0;

  const shippedOrders = orders?.filter(o => o.shipped_at && o.payment_verified_at) || [];
  let totalDays = 0;
  shippedOrders.forEach(o => {
    const days = Math.ceil((new Date(o.shipped_at!).getTime() - new Date(o.payment_verified_at!).getTime()) / (1000 * 60 * 60 * 24));
    totalDays += Math.max(0, days);
  });
  const avgShippingDays = shippedOrders.length > 0 ? Math.round(totalDays / shippedOrders.length) : 0;

  return { avgShippingDays, shippedThisWeek, deliveredThisWeek, pendingShipment };
}

export function ShippingMetrics({ dateRange, embedded }: ShippingMetricsProps) {
  const { data = { avgShippingDays: 0, shippedThisWeek: 0, deliveredThisWeek: 0, pendingShipment: 0 }, isLoading: loading } = useQuery({
    queryKey: ['admin', 'shipping-metrics'],
    queryFn: fetchShippingData,
    staleTime: 2 * 60 * 1000,
  });

  const metrics = [
    { label: 'Avg. Processing Time', value: `${data.avgShippingDays} days`, icon: Clock, color: 'text-blue-500' },
    { label: 'Shipped This Week', value: data.shippedThisWeek, icon: Truck, color: 'text-primary' },
    { label: 'Delivered This Week', value: data.deliveredThisWeek, icon: CheckCircle2, color: 'text-emerald-500' },
    { label: 'Pending Shipment', value: data.pendingShipment, icon: Package, color: data.pendingShipment > 5 ? 'text-yellow-500' : 'text-muted-foreground' },
  ];

  if (loading) {
    if (embedded) return <Skeleton className="h-[120px] w-full" />;
    return (
      <Card className="border-border/50">
        <CardHeader><Skeleton className="h-5 w-40" /></CardHeader>
        <CardContent><div className="grid grid-cols-2 gap-4">{[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div></CardContent>
      </Card>
    );
  }

  const metricsContent = (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {metrics.map((metric) => (
        <div key={metric.label} className="p-3 rounded-lg bg-muted/30">
          <div className="flex items-center gap-2 mb-1">
            <metric.icon className={cn('h-4 w-4', metric.color)} />
            <span className="text-xs text-muted-foreground truncate">{metric.label}</span>
          </div>
          <p className="text-xl font-bold">{metric.value}</p>
        </div>
      ))}
    </div>
  );

  if (embedded) return metricsContent;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Shipping Metrics</CardTitle>
        </div>
        <CardDescription>Fulfillment performance overview</CardDescription>
      </CardHeader>
      <CardContent>{metricsContent}</CardContent>
    </Card>
  );
}
