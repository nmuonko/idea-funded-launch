import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
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
}

export function ShippingMetrics({ dateRange }: ShippingMetricsProps) {
  const [data, setData] = useState<ShippingData>({
    avgShippingDays: 0,
    shippedThisWeek: 0,
    deliveredThisWeek: 0,
    pendingShipment: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadShippingData();
  }, [dateRange]);

  const loadShippingData = async () => {
    try {
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      
      const { data: orders, error } = await supabase
        .from('orders')
        .select('status, shipped_at, delivered_at, payment_verified_at');

      if (error) throw error;

      // Shipped this week
      const shippedThisWeek = orders?.filter(o => 
        o.shipped_at && new Date(o.shipped_at) >= new Date(oneWeekAgo)
      ).length || 0;

      // Delivered this week
      const deliveredThisWeek = orders?.filter(o => 
        o.delivered_at && new Date(o.delivered_at) >= new Date(oneWeekAgo)
      ).length || 0;

      // Pending shipment = PAID or PROCESSING (payment verified but not shipped)
      const pendingShipment = orders?.filter(o => 
        o.payment_verified_at && !o.shipped_at && 
        (o.status === 'PAID' || o.status === 'PROCESSING')
      ).length || 0;

      // Average shipping days (shipped_at - payment_verified_at)
      const shippedOrders = orders?.filter(o => o.shipped_at && o.payment_verified_at) || [];
      let totalDays = 0;
      shippedOrders.forEach(o => {
        const paymentDate = new Date(o.payment_verified_at!);
        const shippedDate = new Date(o.shipped_at!);
        const days = Math.ceil((shippedDate.getTime() - paymentDate.getTime()) / (1000 * 60 * 60 * 24));
        totalDays += Math.max(0, days);
      });
      const avgShippingDays = shippedOrders.length > 0 
        ? Math.round(totalDays / shippedOrders.length) 
        : 0;

      setData({
        avgShippingDays,
        shippedThisWeek,
        deliveredThisWeek,
        pendingShipment,
      });
    } catch (error) {
      console.error('Error loading shipping data:', error);
    } finally {
      setLoading(false);
    }
  };

  const metrics = [
    { 
      label: 'Avg. Processing Time', 
      value: `${data.avgShippingDays} days`, 
      icon: Clock, 
      color: 'text-blue-500',
    },
    { 
      label: 'Shipped This Week', 
      value: data.shippedThisWeek, 
      icon: Truck, 
      color: 'text-primary',
    },
    { 
      label: 'Delivered This Week', 
      value: data.deliveredThisWeek, 
      icon: CheckCircle2, 
      color: 'text-emerald-500',
    },
    { 
      label: 'Pending Shipment', 
      value: data.pendingShipment, 
      icon: Package, 
      color: data.pendingShipment > 5 ? 'text-yellow-500' : 'text-muted-foreground',
    },
  ];

  if (loading) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Truck className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Shipping Metrics</CardTitle>
        </div>
        <CardDescription>Fulfillment performance overview</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <metric.icon className={cn('h-4 w-4', metric.color)} />
                <span className="text-xs text-muted-foreground">{metric.label}</span>
              </div>
              <p className="text-xl font-bold">{metric.value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
