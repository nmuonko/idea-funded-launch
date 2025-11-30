import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, CreditCard, Package, MessageSquare, ArrowRight, Loader2 } from 'lucide-react';

export function PendingActionsWidget() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    unverifiedPayments: 0,
    unfulfilledOrders: 0,
    urgentTickets: 0,
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

      // Unverified payments (orders with no payment verification)
      const { count: unverifiedCount } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .is('payment_verified_at', null)
        .neq('status', 'DRAFT')
        .neq('status', 'CANCELLED');

      // Unfulfilled orders (paid but not shipped or completed)
      const { count: unfulfilledCount } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .in('status', ['PAID', 'PROCESSING']);

      // Urgent tickets (open or high priority)
      const { count: urgentCount } = await supabase
        .from('support_tickets')
        .select('*', { count: 'exact', head: true })
        .in('status', ['open', 'in_progress'])
        .in('priority', ['high', 'urgent']);

      setStats({
        unverifiedPayments: unverifiedCount || 0,
        unfulfilledOrders: unfulfilledCount || 0,
        urgentTickets: urgentCount || 0,
      });
    } catch (error) {
      console.error('Error loading pending actions:', error);
    } finally {
      setLoading(false);
    }
  };

  const totalPending = stats.unverifiedPayments + stats.unfulfilledOrders + stats.urgentTickets;

  const actions = [
    {
      icon: CreditCard,
      label: 'Unverified Payments',
      count: stats.unverifiedPayments,
      color: 'text-red-600 bg-red-50',
      route: '/admin/payments?tab=pending',
    },
    {
      icon: Package,
      label: 'Unfulfilled Orders',
      count: stats.unfulfilledOrders,
      color: 'text-orange-600 bg-orange-50',
      route: '/admin/orders?status=PAID',
    },
    {
      icon: MessageSquare,
      label: 'Urgent Tickets',
      count: stats.urgentTickets,
      color: 'text-purple-600 bg-purple-50',
      route: '/admin/support-tickets?priority=urgent',
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
            <div
              key={action.label}
              className="flex items-center justify-between p-4 rounded-lg border hover:bg-accent transition-colors cursor-pointer"
              onClick={() => navigate(action.route)}
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
            </div>
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
