import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Filter, ShoppingCart, XCircle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DateRange } from './DateRangeFilter';

interface FunnelData {
  activeCarts: number;
  completedOrders: number;
  abandonedCarts: number;
  conversionRate: number;
}

interface ConversionFunnelProps {
  dateRange?: DateRange;
  embedded?: boolean;
}

async function fetchFunnelData(dateRange?: DateRange): Promise<FunnelData> {
  let query = supabase.from('orders').select('status, payment_verified_at, created_at');

  if (dateRange) {
    query = query
      .gte('created_at', dateRange.from.toISOString())
      .lte('created_at', dateRange.to.toISOString());
  }

  const { data: orders, error } = await query;
  if (error) throw error;

  const activeCarts = orders?.filter(o => o.status === 'DRAFT').length || 0;
  const completedOrders = orders?.filter(o => o.payment_verified_at).length || 0;
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const abandonedCarts = orders?.filter(o =>
    (o.status === 'PENDING_PAYMENT' || o.status === 'CANCELLED') &&
    new Date(o.created_at) < oneDayAgo
  ).length || 0;
  const totalCheckoutAttempts = orders?.filter(o => o.status !== 'DRAFT').length || 0;
  const conversionRate = totalCheckoutAttempts > 0
    ? Math.round((completedOrders / totalCheckoutAttempts) * 100)
    : 0;

  return { activeCarts, completedOrders, abandonedCarts, conversionRate };
}

export function ConversionFunnel({ dateRange, embedded }: ConversionFunnelProps) {
  const { data = { activeCarts: 0, completedOrders: 0, abandonedCarts: 0, conversionRate: 0 }, isLoading: loading } = useQuery({
    queryKey: ['admin', 'conversion-funnel', dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: () => fetchFunnelData(dateRange),
    staleTime: 2 * 60 * 1000,
  });

  const metrics = [
    { label: 'Active Carts', value: data.activeCarts, icon: ShoppingCart, color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
    { label: 'Completed', value: data.completedOrders, icon: CheckCircle, color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
    { label: 'Abandoned', value: data.abandonedCarts, icon: XCircle, color: 'text-red-500', bgColor: 'bg-red-500/10' },
  ];

  if (loading) {
    if (embedded) return <Skeleton className="h-[280px] w-full" />;
    return (
      <Card className="border-border/50">
        <CardHeader><Skeleton className="h-5 w-40" /><Skeleton className="h-4 w-60 mt-1" /></CardHeader>
        <CardContent className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</CardContent>
      </Card>
    );
  }

  const funnelContent = (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Cart to purchase journey</p>
      <div className="grid grid-cols-3 gap-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="flex flex-col items-center p-3 rounded-lg bg-muted/30">
            <metric.icon className={cn('h-5 w-5 mb-2', metric.color)} />
            <p className="text-2xl font-bold">{metric.value}</p>
            <p className="text-xs text-muted-foreground text-center">{metric.label}</p>
          </div>
        ))}
      </div>
      <div className="pt-3 border-t border-border/50">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Conversion Rate</span>
          <span className={cn('text-lg font-bold', data.conversionRate >= 50 ? 'text-emerald-500' : data.conversionRate >= 25 ? 'text-yellow-500' : 'text-red-500')}>
            {data.conversionRate}%
          </span>
        </div>
        <Progress value={data.conversionRate} className="h-2" />
      </div>
    </div>
  );

  if (embedded) return funnelContent;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Conversion Funnel</CardTitle>
        </div>
      </CardHeader>
      <CardContent>{funnelContent}</CardContent>
    </Card>
  );
}
