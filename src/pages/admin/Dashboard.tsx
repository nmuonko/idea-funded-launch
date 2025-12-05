import { useEffect, useState } from 'react';
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

export default function AdminDashboard() {
  const { language } = useLanguage();
  const t = getAdminTranslation(language);
  
  const [dateRange, setDateRange] = useState<DateRange>(() => getDateRangeFromPreset('30days'));
  const [stats, setStats] = useState<DashboardStats>({
    totalOrders: 0,
    paidOrders: 0,
    pendingPayments: 0,
    totalRevenue: 0,
    ordersTrend: 0,
    revenueTrend: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, [dateRange]);

  const loadStats = async () => {
    try {
      setLoading(true);

      // Get orders within date range
      const { data: periodOrders, error: periodError } = await supabase
        .from('orders')
        .select('id, status, total_usd, service_fee_usd, payment_verified_at, created_at')
        .gte('created_at', dateRange.from.toISOString())
        .lte('created_at', dateRange.to.toISOString());

      if (periodError) throw periodError;

      // Calculate the previous period for trend comparison
      const periodLength = dateRange.to.getTime() - dateRange.from.getTime();
      const previousFrom = new Date(dateRange.from.getTime() - periodLength);
      const previousTo = new Date(dateRange.from.getTime() - 1);

      const { data: previousOrders, error: prevError } = await supabase
        .from('orders')
        .select('id, status, total_usd, service_fee_usd, payment_verified_at, created_at')
        .gte('created_at', previousFrom.toISOString())
        .lte('created_at', previousTo.toISOString());

      if (prevError) throw prevError;

      // Current period stats
      const totalOrders = periodOrders?.filter(o => o.status !== 'DRAFT').length || 0;
      const paidOrdersList = periodOrders?.filter(o => o.payment_verified_at) || [];
      const paidOrders = paidOrdersList.length;
      const pendingPayments = periodOrders?.filter(o => o.status === 'PENDING_PAYMENT').length || 0;
      const totalRevenue = paidOrdersList.reduce((sum, o) => sum + Number(o.total_usd || 0), 0);

      // Previous period stats for trends
      const prevOrderCount = previousOrders?.filter(o => o.status !== 'DRAFT').length || 0;
      const prevRevenue = previousOrders
        ?.filter(o => o.payment_verified_at)
        .reduce((sum, o) => sum + Number(o.total_usd || 0), 0) || 0;

      const ordersTrend = prevOrderCount > 0 
        ? Math.round(((totalOrders - prevOrderCount) / prevOrderCount) * 100)
        : 0;
      const revenueTrend = prevRevenue > 0
        ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100)
        : 0;

      setStats({
        totalOrders,
        paidOrders,
        pendingPayments,
        totalRevenue,
        ordersTrend,
        revenueTrend,
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

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

      {/* Main Grid Layout - Clean 3 + 1 columns */}
      <div className="grid gap-8 lg:grid-cols-[1fr_200px]">
        {/* Left Side - Main Content */}
        <div className="space-y-8 min-w-0">
          {/* A. Top Summary Bar - 4 KPI Cards (removed Service Fees) */}
          <div className="grid gap-5 grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              title={t.dashboard.totalOrders}
              value={stats.totalOrders}
              icon={Package}
              trend={stats.ordersTrend}
              trendLabel={t.dashboard.vsPrev}
              isLoading={loading}
            />
            <SummaryCard
              title={t.dashboard.paidOrders}
              value={stats.paidOrders}
              icon={TrendingUp}
              iconColor="text-emerald-500"
              isLoading={loading}
            />
            <SummaryCard
              title={t.dashboard.pending}
              value={stats.pendingPayments}
              icon={Clock}
              iconColor="text-yellow-500"
              isLoading={loading}
            />
            <SummaryCard
              title={t.dashboard.revenue}
              value={formatUSD(stats.totalRevenue)}
              icon={DollarSign}
              iconColor="text-primary"
              trend={stats.revenueTrend}
              trendLabel={t.dashboard.vsPrev}
              isLoading={loading}
            />
          </div>

          {/* B. Primary Chart with Tabs (Orders Overview + Conversion) */}
          <ChartTabs dateRange={dateRange} />

          {/* C. Operational Insights - Tabbed (Shipping, Payments, Saved Carts) */}
          <OperationalInsightsTabs dateRange={dateRange} />
        </div>

        {/* D. Right Side Panel - Slim Sticky Sidebar */}
        <div className="lg:sticky lg:top-4 lg:self-start space-y-6">
          <PendingActionsSidebar />
          <CustomerOverviewWidget />
        </div>
      </div>

      {/* AI Assistant - Floating */}
      <AIAdminAssistant floating />
    </div>
  );
}
