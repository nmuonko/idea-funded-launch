import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { BarChart3 } from 'lucide-react';

interface MonthlyData {
  month: string;
  paid: number;
  unpaid: number;
  total: number;
}

export function OrdersOverviewChart() {
  const [data, setData] = useState<MonthlyData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadChartData();
  }, []);

  const loadChartData = async () => {
    try {
      const { data: orders, error } = await supabase
        .from('orders')
        .select('created_at, payment_verified_at, status')
        .neq('status', 'DRAFT');

      if (error) throw error;

      // Group by month
      const monthlyMap = new Map<string, { paid: number; unpaid: number }>();
      const now = new Date();
      
      // Initialize last 6 months
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

      const chartData: MonthlyData[] = Array.from(monthlyMap.entries()).map(([month, counts]) => ({
        month,
        paid: counts.paid,
        unpaid: counts.unpaid,
        total: counts.paid + counts.unpaid,
      }));

      setData(chartData);
    } catch (error) {
      console.error('Error loading chart data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
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

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Orders Overview</CardTitle>
        </div>
        <CardDescription>Monthly orders breakdown (last 6 months)</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
              <XAxis 
                dataKey="month" 
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                className="text-muted-foreground"
              />
              <YAxis 
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={false}
                className="text-muted-foreground"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar dataKey="paid" name="Paid" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              <Bar dataKey="unpaid" name="Unpaid" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
