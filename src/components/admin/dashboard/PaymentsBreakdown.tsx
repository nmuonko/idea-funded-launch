import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { CreditCard } from 'lucide-react';
import { formatUSD } from '@/lib/formatCurrency';
import { cn } from '@/lib/utils';
import type { DateRange } from './DateRangeFilter';

interface PaymentData {
  totalPayments: number;
  successfulPayments: number;
  failedPayments: number;
  successRate: number;
  totalRevenue: number;
  pawapayRevenue: number;
  stripeRevenue: number;
}

interface PaymentsBreakdownProps {
  dateRange?: DateRange;
  embedded?: boolean;
}

export function PaymentsBreakdown({ dateRange, embedded }: PaymentsBreakdownProps) {
  const [data, setData] = useState<PaymentData>({
    totalPayments: 0,
    successfulPayments: 0,
    failedPayments: 0,
    successRate: 0,
    totalRevenue: 0,
    pawapayRevenue: 0,
    stripeRevenue: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPaymentData();
  }, [dateRange]);

  const loadPaymentData = async () => {
    try {
      let query = supabase
        .from('payment_attempts')
        .select('status, amount, provider');

      if (dateRange?.from) {
        query = query.gte('created_at', dateRange.from.toISOString());
      }
      if (dateRange?.to) {
        query = query.lte('created_at', dateRange.to.toISOString());
      }

      const { data: attempts, error } = await query;
      if (error) throw error;

      const all = attempts || [];
      const totalPayments = all.length;
      const paid = all.filter(a => a.status === 'paid' || a.status === 'success');
      const failed = all.filter(a => a.status === 'failed' || a.status === 'expired');
      const successfulPayments = paid.length;
      const failedPayments = failed.length;
      const successRate = totalPayments > 0 ? Math.round((successfulPayments / totalPayments) * 100) : 0;

      const totalRevenue = paid.reduce((sum, a) => sum + Number(a.amount || 0), 0);
      const pawapayRevenue = paid
        .filter(a => a.provider === 'pawapay')
        .reduce((sum, a) => sum + Number(a.amount || 0), 0);
      const stripeRevenue = paid
        .filter(a => a.provider === 'stripe')
        .reduce((sum, a) => sum + Number(a.amount || 0), 0);

      setData({
        totalPayments,
        successfulPayments,
        failedPayments,
        successRate,
        totalRevenue,
        pawapayRevenue,
        stripeRevenue,
      });
    } catch (error) {
      console.error('Error loading payment data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    if (embedded) {
      return <Skeleton className="h-[180px] w-full" />;
    }
    return (
      <Card className="border-border/50">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const paymentsContent = (
    <div className="space-y-4">
      {/* Success Rate */}
      <div className="p-3 rounded-lg bg-muted/30">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Success Rate</span>
          <span className={cn(
            'text-lg font-bold',
            data.successRate >= 90 ? 'text-emerald-500' : 
            data.successRate >= 70 ? 'text-yellow-500' : 'text-red-500'
          )}>
            {data.successRate}%
          </span>
        </div>
        <Progress value={data.successRate} className="h-2" />
      </div>

      {/* Payment Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="p-2 rounded-lg bg-muted/30 text-center">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-lg font-bold">{data.totalPayments}</p>
        </div>
        <div className="p-2 rounded-lg bg-emerald-500/10 text-center">
          <p className="text-xs text-emerald-500">Success</p>
          <p className="text-lg font-bold text-emerald-500">{data.successfulPayments}</p>
        </div>
        <div className="p-2 rounded-lg bg-red-500/10 text-center">
          <p className="text-xs text-red-500">Failed</p>
          <p className="text-lg font-bold text-red-500">{data.failedPayments}</p>
        </div>
      </div>

      {/* Revenue by Method */}
      <div className="pt-3 border-t border-border/50 space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Revenue by Method</p>
        <div className="flex items-center justify-between p-2 rounded-lg bg-primary/5">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary" />
            <span className="text-sm">PawaPay</span>
          </div>
          <span className="font-semibold">{formatUSD(data.pawapayRevenue)}</span>
        </div>
        <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-sm">Stripe</span>
          </div>
          <span className="font-semibold">{formatUSD(data.stripeRevenue)}</span>
        </div>
      </div>
    </div>
  );

  if (embedded) {
    return paymentsContent;
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Payments Breakdown</CardTitle>
        </div>
        <CardDescription>Payment methods & success rates</CardDescription>
      </CardHeader>
      <CardContent>
        {paymentsContent}
      </CardContent>
    </Card>
  );
}
