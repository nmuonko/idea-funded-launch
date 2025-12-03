import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { CreditCard, CheckCircle, XCircle, DollarSign } from 'lucide-react';
import { formatUSD } from '@/lib/formatCurrency';
import { cn } from '@/lib/utils';

interface PaymentData {
  totalPayments: number;
  successfulPayments: number;
  failedPayments: number;
  successRate: number;
  totalRevenue: number;
  maishaPayRevenue: number;
}

export function PaymentsBreakdown() {
  const [data, setData] = useState<PaymentData>({
    totalPayments: 0,
    successfulPayments: 0,
    failedPayments: 0,
    successRate: 0,
    totalRevenue: 0,
    maishaPayRevenue: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPaymentData();
  }, []);

  const loadPaymentData = async () => {
    try {
      // Get payment records from maisha_payments
      const { data: payments, error: paymentError } = await supabase
        .from('maisha_payments')
        .select('status, amount_usd');

      if (paymentError) throw paymentError;

      // Get paid orders for revenue
      const { data: orders, error: orderError } = await supabase
        .from('orders')
        .select('total_usd, payment_verified_at, maisha_transaction_id');

      if (orderError) throw orderError;

      const totalPayments = payments?.length || 0;
      const successfulPayments = payments?.filter(p => p.status === 'success' || p.status === 'paid').length || 0;
      const failedPayments = payments?.filter(p => p.status === 'failed').length || 0;
      const successRate = totalPayments > 0 ? Math.round((successfulPayments / totalPayments) * 100) : 0;

      // Total revenue from paid orders
      const paidOrders = orders?.filter(o => o.payment_verified_at) || [];
      const totalRevenue = paidOrders.reduce((sum, o) => sum + Number(o.total_usd || 0), 0);

      // MaishaPay revenue (orders with maisha_transaction_id)
      const maishaPayRevenue = paidOrders
        .filter(o => o.maisha_transaction_id)
        .reduce((sum, o) => sum + Number(o.total_usd || 0), 0);

      setData({
        totalPayments,
        successfulPayments,
        failedPayments,
        successRate,
        totalRevenue,
        maishaPayRevenue,
      });
    } catch (error) {
      console.error('Error loading payment data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
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

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Payments Breakdown</CardTitle>
        </div>
        <CardDescription>Payment methods & success rates</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
              <span className="text-sm">MaishaPay</span>
            </div>
            <span className="font-semibold">{formatUSD(data.maishaPayRevenue)}</span>
          </div>
          <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-muted-foreground" />
              <span className="text-sm">Other</span>
            </div>
            <span className="font-semibold">{formatUSD(data.totalRevenue - data.maishaPayRevenue)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
