import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { 
  AlertCircle, 
  CreditCard, 
  Package, 
  RefreshCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';

interface ActionItem {
  icon: React.ElementType;
  label: string;
  description: string;
  count: number;
  color: string;
  bgColor: string;
  route: string;
}

async function fetchPendingActions() {
  const [unverifiedRes, unfulfilledRes, refundRes] = await Promise.all([
    supabase.from('orders').select('*', { count: 'exact', head: true }).eq('status', 'PENDING_PAYMENT'),
    supabase.from('orders').select('*', { count: 'exact', head: true }).in('status', ['PAID', 'PROCESSING']),
    supabase.from('orders').select('*', { count: 'exact', head: true }).not('refund_issued_at', 'is', null),
  ]);

  return {
    unverifiedPayments: unverifiedRes.count || 0,
    unfulfilledOrders: unfulfilledRes.count || 0,
    refundIssued: refundRes.count || 0,
  };
}

export function PendingActionsSidebar() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const t = getAdminTranslation(language);

  const { data: stats, isLoading: loading } = useQuery({
    queryKey: ['admin', 'pending-actions'],
    queryFn: fetchPendingActions,
    staleTime: 2 * 60 * 1000,
    refetchInterval: 120_000,
  });

  const safeStats = stats || { unverifiedPayments: 0, unfulfilledOrders: 0, refundIssued: 0 };

  const actions: ActionItem[] = [
    {
      icon: CreditCard,
      label: t.dashboard.unverifiedPayments,
      description: t.dashboard.awaitingVerification,
      count: safeStats.unverifiedPayments,
      color: 'text-red-500',
      bgColor: 'bg-red-500/10',
      route: '/admin/payments?tab=pending',
    },
    {
      icon: Package,
      label: t.dashboard.unfulfilledOrders,
      description: t.dashboard.paidNotShipped,
      count: safeStats.unfulfilledOrders,
      color: 'text-orange-500',
      bgColor: 'bg-orange-500/10',
      route: '/admin/orders',
    },
    {
      icon: RefreshCcw,
      label: 'Refunds Issued',
      description: 'Orders with refunds',
      count: safeStats.refundIssued,
      color: 'text-yellow-500',
      bgColor: 'bg-yellow-500/10',
      route: '/admin/orders?status=refunded',
    },
  ];

  const totalPending = Object.values(safeStats).reduce((sum, val) => sum + val, 0);

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
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/30 backdrop-blur-sm sticky top-4">
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm font-medium">Actions</CardTitle>
          </div>
          {totalPending > 0 && (
            <Badge variant="destructive" className="text-xs h-5 px-1.5">
              {totalPending}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-2 pb-3 pt-0 space-y-1">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => navigate(action.route)}
            className={cn(
              'w-full flex items-center gap-2 px-2 py-2 rounded-md',
              'hover:bg-muted/50 transition-colors duration-150',
              'text-left group'
            )}
          >
            <action.icon className={cn('h-4 w-4 shrink-0', action.color)} />
            <span className="text-xs font-medium flex-1 truncate">{action.label}</span>
            <span className={cn(
              'text-xs font-semibold min-w-[20px] text-right',
              action.count > 0 ? action.color : 'text-muted-foreground'
            )}>
              {action.count}
            </span>
          </button>
        ))}

        {totalPending === 0 && (
          <div className="text-center py-4">
            <span className="text-lg">✓</span>
            <p className="text-xs text-muted-foreground mt-1">{t.dashboard.allCaughtUp}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
