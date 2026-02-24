import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Package, TrendingUp, DollarSign, Clock } from 'lucide-react';
import { RealtimeNotifications } from '@/components/admin/RealtimeNotifications';
import { AIAdminAssistant } from '@/components/admin/AIAdminAssistant';

import { formatUSD } from '@/lib/formatCurrency';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';

// Dashboard Components
import { SummaryCard } from '@/components/admin/dashboard/SummaryCard';
import { ChartTabs } from '@/components/admin/dashboard/ChartTabs';
import { PendingActionsSidebar } from '@/components/admin/dashboard/PendingActionsSidebar';
import { OperationalInsightsTabs } from '@/components/admin/dashboard/OperationalInsightsTabs';
import { DateRangeFilter, type DateRange, getDateRangeFromPreset } from '@/components/admin/dashboard/DateRangeFilter';
import { CustomerOverviewWidget } from '@/components/admin/dashboard/CustomerOverviewWidget';

interface DashboardStats {
  totalOrders: number;
  paidOrders: number;
  pendingPayments: number;
  totalRevenue: number;
  ordersTrend: number;
  revenueTrend: number;
}

const defaultStats: DashboardStats = {
  totalOrders: 0,
  paidOrders: 0,
  pendingPayments: 0,
  totalRevenue: 0,
  ordersTrend: 0,
  revenueTrend: 0,
};

async function loadDashboardStats(dateRange: DateRange): Promise<DashboardStats> {
  // Calculate previous period
  const periodLength = dateRange.to.getTime() - dateRange.from.getTime();
  const previousFrom = new Date(dateRange.from.getTime() - periodLength);
  const previousTo = new Date(dateRange.from.getTime() - 1);

  // Fetch current + previous period orders in parallel
  const [currentRes, previousRes] = await Promise.all([
    supabase
      .from('orders')
      .select('id, status, total_usd, service_fee_usd, payment_verified_at, created_at')
      .gte('created_at', dateRange.from.toISOString())
      .lte('created_at', dateRange.to.toISOString()),
    supabase
      .from('orders')
      .select('id, status, total_usd, service_fee_usd, payment_verified_at, created_at')
      .gte('created_at', previousFrom.toISOString())
      .lte('created_at', previousTo.toISOString()),
  ]);

  if (currentRes.error) throw currentRes.error;
  if (previousRes.error) throw previousRes.error;

  const periodOrders = currentRes.data || [];
  const previousOrders = previousRes.data || [];

  const paidOrderIds = periodOrders.filter(o => o.payment_verified_at).map(o => o.id);
  const prevPaidOrderIds = previousOrders.filter(o => o.payment_verified_at).map(o => o.id);

  // Fetch markup fees for both periods in parallel
  const [currentItemsRes, prevItemsRes] = await Promise.all([
    paidOrderIds.length > 0
      ? supabase.from('order_items').select('markup_fee_usd').in('order_id', paidOrderIds)
      : Promise.resolve({ data: [], error: null }),
    prevPaidOrderIds.length > 0
      ? supabase.from('order_items').select('markup_fee_usd').in('order_id', prevPaidOrderIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const totalMarkupProfit = (currentItemsRes.data || []).reduce(
    (sum, item) => sum + Number(item.markup_fee_usd || 0), 0
  );
  const prevMarkupProfit = (prevItemsRes.data || []).reduce(
    (sum, item) => sum + Number(item.markup_fee_usd || 0), 0
  );

  const totalOrders = periodOrders.filter(o => o.status !== 'DRAFT').length;
  const paidOrders = paidOrderIds.length;
  const pendingPayments = periodOrders.filter(o => o.status === 'PENDING_PAYMENT').length;
  const prevOrderCount = previousOrders.filter(o => o.status !== 'DRAFT').length;

  const ordersTrend = prevOrderCount > 0
    ? Math.round(((totalOrders - prevOrderCount) / prevOrderCount) * 100)
    : 0;
  const revenueTrend = prevMarkupProfit > 0
    ? Math.round(((totalMarkupProfit - prevMarkupProfit) / prevMarkupProfit) * 100)
    : 0;

  return {
    totalOrders,
    paidOrders,
    pendingPayments,
    totalRevenue: totalMarkupProfit,
    ordersTrend,
    revenueTrend,
  };
}

export default function AdminDashboard() {
  const { language } = useLanguage();
  const t = getAdminTranslation(language);
  
  const [dateRange, setDateRange] = useState<DateRange>(() => getDateRangeFromPreset('30days'));

  const { data: stats = defaultStats, isLoading: loading } = useQuery({
    queryKey: ['admin', 'dashboard-stats', dateRange.from.toISOString(), dateRange.to.toISOString()],
    queryFn: () => loadDashboardStats(dateRange),
    staleTime: 2 * 60 * 1000,
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <RealtimeNotifications />
      
      {/* Header with Date Range Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t.dashboard.title}</h1>
          <p className="text-sm text-muted-foreground">{t.dashboard.subtitle}</p>
        </div>
        <DateRangeFilter 
          dateRange={dateRange} 
          onDateRangeChange={setDateRange} 
        />
      </div>

      {/* Main Grid Layout */}
      <div className="grid gap-8 lg:grid-cols-[1fr_200px]">
        <div className="space-y-8 min-w-0">
          {/* KPI Cards */}
          <div className="grid gap-5 grid-cols-2 lg:grid-cols-4">
            <SummaryCard title={t.dashboard.totalOrders} value={stats.totalOrders} icon={Package} trend={stats.ordersTrend} trendLabel={t.dashboard.vsPrev} isLoading={loading} />
            <SummaryCard title={t.dashboard.paidOrders} value={stats.paidOrders} icon={TrendingUp} iconColor="text-emerald-500" isLoading={loading} />
            <SummaryCard title={t.dashboard.pending} value={stats.pendingPayments} icon={Clock} iconColor="text-yellow-500" isLoading={loading} />
            <SummaryCard title="Markup Profit" value={formatUSD(stats.totalRevenue)} icon={DollarSign} iconColor="text-emerald-500" trend={stats.revenueTrend} trendLabel={t.dashboard.vsPrev} isLoading={loading} />
          </div>

          <ChartTabs dateRange={dateRange} />
          <OperationalInsightsTabs dateRange={dateRange} />
        </div>

        <div className="lg:sticky lg:top-4 lg:self-start space-y-6">
          <PendingActionsSidebar />
          <CustomerOverviewWidget />
        </div>
      </div>

      <AIAdminAssistant floating />
    </div>
  );
}
