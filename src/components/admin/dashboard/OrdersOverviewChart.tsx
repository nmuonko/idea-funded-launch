import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { BarChart3 } from 'lucide-react';
import type { DateRange } from './DateRangeFilter';

interface MonthlyData {
  month: string;
  paid: number;
  unpaid: number;
  total: number;
}

interface OrdersOverviewChartProps {
  dateRange?: DateRange;
  embedded?: boolean;
}

async function fetchChartData(): Promise<MonthlyData[]> {
  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const { data: orders, error } = await supabase
    .from('orders')
    .select('created_at, payment_verified_at, status')
    .neq('status', 'DRAFT')
    .gte('created_at', sixMonthsAgo.toISOString());

  if (error) throw error;

  const monthlyMap = new Map<string, { paid: number; unpaid: number }>();

  for (let i = 5; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    monthlyMap.set(key, { paid: 0, unpaid: 0 });
  }

  orders?.forEach((order) => {
    const date = new Date(order.created_at);
    const key = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    if (monthlyMap.has(key)) {
      const current = monthlyMap.get(key)!;
      if (order.payment_verified_at) {
        current.paid++;
      } else {
        current.unpaid++;
      }
    }
  });

  return Array.from(monthlyMap.entries()).map(([month, counts]) => ({
    month,
    paid: counts.paid,
    unpaid: counts.unpaid,
    total: counts.paid + counts.unpaid,
  }));
}

export function OrdersOverviewChart({ dateRange, embedded }: OrdersOverviewChartProps) {
  const { data = [], isLoading: loading } = useQuery({
    queryKey: ['admin', 'orders-overview-chart'],
    queryFn: fetchChartData,
    staleTime: 2 * 60 * 1000,
  });

  if (loading) {
    if (embedded) {
      return <Skeleton className="h-[280px] w-full" />;
    }
    return (
      <Card className="border-border/50">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-60 mt-1" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[250px] w-full" />
        </CardContent>
      </Card>
    );
  }

  const chartContent = (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Monthly orders breakdown (last 6 months)</p>
      <div className="h-[250px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} className="text-muted-foreground" />
            <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} className="text-muted-foreground" />
            <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }} />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Bar dataKey="paid" name="Paid" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            <Bar dataKey="unpaid" name="Unpaid" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  if (embedded) return chartContent;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Orders Overview</CardTitle>
        </div>
      </CardHeader>
      <CardContent>{chartContent}</CardContent>
    </Card>
  );
}
