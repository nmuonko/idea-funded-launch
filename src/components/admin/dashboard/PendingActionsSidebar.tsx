import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { 
  AlertCircle, 
  CreditCard, 
  Package, 
  MessageSquare, 
  ArrowRight,
  RefreshCcw,
  AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface ActionItem {
  icon: React.ElementType;
  label: string;
  description: string;
  count: number;
  color: string;
  bgColor: string;
  route: string;
}

export function PendingActionsSidebar() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    unverifiedPayments: 0,
    unfulfilledOrders: 0,
    urgentTickets: 0,
    refundRequests: 0,
  });

  useEffect(() => {
    loadPendingActions();
    const interval = setInterval(loadPendingActions, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadPendingActions = async () => {
    try {
      setLoading(true);

      // Unverified payments
      const { count: unverifiedCount } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'PENDING_PAYMENT');

      // Unfulfilled orders
      const { count: unfulfilledCount } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .in('status', ['PAID', 'PROCESSING']);

      // Urgent tickets
      const { count: urgentCount } = await supabase
        .from('support_tickets')
        .select('*', { count: 'exact', head: true })
        .in('priority', ['high', 'urgent'])
        .in('status', ['open', 'in_progress']);

      setStats({
        unverifiedPayments: unverifiedCount || 0,
        unfulfilledOrders: unfulfilledCount || 0,
        urgentTickets: urgentCount || 0,
        refundRequests: 0, // Placeholder for future implementation
      });
    } catch (error) {
      console.error('Error loading pending actions:', error);
    } finally {
      setLoading(false);
    }
  };

  const actions: ActionItem[] = [
    {
      icon: CreditCard,
      label: 'Unverified Payments',
      description: 'Awaiting verification',
      count: stats.unverifiedPayments,
      color: 'text-red-500',
      bgColor: 'bg-red-500/10',
      route: '/admin/payments',
    },
    {
      icon: Package,
      label: 'Unfulfilled Orders',
      description: 'Paid but not shipped',
      count: stats.unfulfilledOrders,
      color: 'text-orange-500',
      bgColor: 'bg-orange-500/10',
      route: '/admin/orders',
    },
    {
      icon: MessageSquare,
      label: 'Urgent Tickets',
      description: 'High priority support',
      count: stats.urgentTickets,
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/10',
      route: '/admin/support',
    },
    {
      icon: RefreshCcw,
      label: 'Refund Requests',
      description: 'Pending review',
      count: stats.refundRequests,
      color: 'text-yellow-500',
      bgColor: 'bg-yellow-500/10',
      route: '/admin/payments',
    },
  ];

  const totalPending = Object.values(stats).reduce((sum, val) => sum + val, 0);

  if (loading) {
    return (
      <Card className="border-border/50 sticky top-4">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-6 w-8 rounded-full" />
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm sticky top-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Pending Actions</CardTitle>
          </div>
          {totalPending > 0 && (
            <Badge variant="destructive" className="font-bold">
              {totalPending}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => navigate(action.route)}
            className={cn(
              'w-full flex items-center gap-3 p-3 rounded-lg border border-transparent',
              'hover:border-border/50 hover:bg-muted/50 transition-all duration-200',
              'text-left group'
            )}
          >
            <div className={cn('p-2 rounded-lg', action.bgColor)}>
              <action.icon className={cn('h-4 w-4', action.color)} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{action.label}</p>
              <p className="text-xs text-muted-foreground">{action.description}</p>
            </div>
            <div className="flex items-center gap-2">
              {action.count > 0 ? (
                <Badge variant="secondary" className={cn('font-semibold', action.count > 0 && action.color)}>
                  {action.count}
                </Badge>
              ) : (
                <span className="text-xs text-muted-foreground">0</span>
              )}
              <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
        ))}

        {totalPending === 0 && (
          <div className="text-center py-6">
            <div className="text-3xl mb-2">✓</div>
            <p className="text-sm font-medium text-muted-foreground">All caught up!</p>
            <p className="text-xs text-muted-foreground">No pending actions</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
