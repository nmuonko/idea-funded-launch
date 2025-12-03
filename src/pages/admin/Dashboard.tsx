import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Package, TrendingUp, DollarSign, Clock, Percent } from 'lucide-react';
import { RealtimeNotifications } from '@/components/admin/RealtimeNotifications';
import { AIAdminAssistant } from '@/components/admin/AIAdminAssistant';
import { formatUSD } from '@/lib/formatCurrency';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';
import { subDays, startOfDay, endOfDay } from 'date-fns';

// Dashboard Components
import { SummaryCard } from '@/components/admin/dashboard/SummaryCard';
import { OrdersOverviewChart } from '@/components/admin/dashboard/OrdersOverviewChart';
import { ConversionFunnel } from '@/components/admin/dashboard/ConversionFunnel';
import { PendingActionsSidebar } from '@/components/admin/dashboard/PendingActionsSidebar';
import { ShippingMetrics } from '@/components/admin/dashboard/ShippingMetrics';
import { PaymentsBreakdown } from '@/components/admin/dashboard/PaymentsBreakdown';
import { SavedCartsReport } from '@/components/admin/dashboard/SavedCartsReport';
import { DateRangeFilter, type DateRange, getDateRangeFromPreset } from '@/components/admin/dashboard/DateRangeFilter';

interface DashboardStats {
  totalOrders: number;
  paidOrders: number;
  pendingPayments: number;
  totalRevenue: number;
  serviceFees: number;
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
    serviceFees: 0,
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
      const serviceFees = paidOrdersList.reduce((sum, o) => sum + Number(o.service_fee_usd || 0), 0);

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
        serviceFees,
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
    <div className="space-y-6 animate-in fade-in duration-500">
      <RealtimeNotifications />
      
      {/* Header with Date Range Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t.dashboard.title}</h1>
          <p className="text-muted-foreground text-sm">Real-time business metrics and insights</p>
        </div>
        <DateRangeFilter 
          dateRange={dateRange} 
          onDateRangeChange={setDateRange} 
        />
      </div>

      {/* Main Grid Layout */}
      <div className="grid gap-6 lg:grid-cols-4">
        {/* Left Side - Main Content (3 columns on lg) */}
        <div className="lg:col-span-3 space-y-6">
          {/* A. Top Summary Bar - 5 KPI Cards */}
          <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            <SummaryCard
              title="Total Orders"
              value={stats.totalOrders}
              icon={Package}
              trend={stats.ordersTrend}
              trendLabel="vs prev period"
              isLoading={loading}
            />
            <SummaryCard
              title="Paid Orders"
              value={stats.paidOrders}
              icon={TrendingUp}
              iconColor="text-emerald-500"
              isLoading={loading}
            />
            <SummaryCard
              title="Pending Payments"
              value={stats.pendingPayments}
              icon={Clock}
              iconColor="text-yellow-500"
              isLoading={loading}
            />
            <SummaryCard
              title="Revenue"
              value={formatUSD(stats.totalRevenue)}
              icon={DollarSign}
              iconColor="text-primary"
              trend={stats.revenueTrend}
              trendLabel="vs prev period"
              isLoading={loading}
            />
            <SummaryCard
              title="Service Fees"
              value={formatUSD(stats.serviceFees)}
              icon={Percent}
              iconColor="text-blue-500"
              isLoading={loading}
            />
          </div>

          {/* B. Middle Section - Two Large Panels */}
          <div className="grid gap-6 md:grid-cols-2">
            <OrdersOverviewChart dateRange={dateRange} />
            <ConversionFunnel dateRange={dateRange} />
          </div>

          {/* D. Bottom Section - Operational Insights */}
          <div className="grid gap-6 md:grid-cols-3">
            <ShippingMetrics dateRange={dateRange} />
            <PaymentsBreakdown dateRange={dateRange} />
            <SavedCartsReport />
          </div>
        </div>

        {/* C. Right Side Panel - Sticky */}
        <div className="lg:col-span-1">
          <PendingActionsSidebar />
        </div>
      </div>

      {/* AI Assistant - Floating */}
      <AIAdminAssistant floating />
    </div>
  );
}
