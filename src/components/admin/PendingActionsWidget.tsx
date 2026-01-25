import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CreditCard, Package, ArrowRight, Loader2, Car, RefreshCcw } from 'lucide-react';

export function PendingActionsWidget() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    unverifiedPayments: 0,
    unfulfilledOrders: 0,
    pendingQuotes: 0,
    refundIssued: 0,
  });

  useEffect(() => {
    loadPendingActions();
    
    // Refresh every 30 seconds
    const interval = setInterval(loadPendingActions, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadPendingActions = async () => {
    try {
      setLoading(true);

      // Unverified payments = orders with status PENDING_PAYMENT or paid but not verified
      const { count: unverifiedCount } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'PENDING_PAYMENT');

      // Unfulfilled orders = PAID or PROCESSING orders (paid but not shipped/completed)
      const { count: unfulfilledCount } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .in('status', ['PAID', 'PROCESSING']);

      // Pending vehicle quotes
      const { count: pendingQuotesCount } = await supabase
        .from('quote_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'PENDING');

      // Refunds issued
      const { count: refundCount } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .not('refund_issued_at', 'is', null);

      setStats({
        unverifiedPayments: unverifiedCount || 0,
        unfulfilledOrders: unfulfilledCount || 0,
        pendingQuotes: pendingQuotesCount || 0,
        refundIssued: refundCount || 0,
      });
    } catch (error) {
      console.error('Error loading pending actions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleNavigation = (route: string) => {
    // Use navigate instead of direct navigation to prevent logout issues
    navigate(route);
  };

  const totalPending = stats.unverifiedPayments + stats.unfulfilledOrders + stats.pendingQuotes + stats.refundIssued;

  const actions = [
    {
      icon: CreditCard,
      label: 'Unverified Payments',
      description: 'Orders awaiting payment verification',
      count: stats.unverifiedPayments,
      color: 'text-red-600 bg-red-50 dark:bg-red-950',
      route: '/admin/payments',
    },
    {
      icon: Package,
      label: 'Unfulfilled Orders',
      description: 'Paid orders not yet shipped',
      count: stats.unfulfilledOrders,
      color: 'text-orange-600 bg-orange-50 dark:bg-orange-950',
      route: '/admin/orders',
    },
    {
      icon: Car,
      label: 'Pending Quotes',
      description: 'Vehicle quotes awaiting pricing',
      count: stats.pendingQuotes,
      color: 'text-blue-600 bg-blue-50 dark:bg-blue-950',
      route: '/admin/quote-requests',
    },
    {
      icon: RefreshCcw,
      label: 'Refunds Issued',
      description: 'Orders with refunds processed',
      count: stats.refundIssued,
      color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950',
      route: '/admin/orders?status=refunded',
    },
  ];

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Pending Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="flex justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              Pending Actions
            </CardTitle>
            <CardDescription>
              {totalPending === 0 ? 'All caught up!' : `${totalPending} item(s) need attention`}
            </CardDescription>
          </div>
          {totalPending > 0 && (
            <Badge variant="destructive" className="text-lg font-bold">
              {totalPending}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="w-full flex items-center justify-between p-4 rounded-lg border hover:bg-accent transition-colors cursor-pointer text-left"
              onClick={() => handleNavigation(action.route)}
            >
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${action.color}`}>
                  <action.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium">{action.label}</p>
                  <p className="text-sm text-muted-foreground">
                    {action.count === 0 ? 'None pending' : `${action.count} pending`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {action.count > 0 && (
                  <Badge variant="secondary" className="font-semibold">
                    {action.count}
                  </Badge>
                )}
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </button>
          ))}
        </div>

        {totalPending === 0 && (
          <div className="text-center p-8 text-muted-foreground">
            <div className="text-4xl mb-2">✓</div>
            <p className="font-medium">All tasks completed</p>
            <p className="text-sm">No pending actions at this time</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
