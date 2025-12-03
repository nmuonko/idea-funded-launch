import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Package, TrendingUp, DollarSign, Clock, Percent } from 'lucide-react';
import { RealtimeNotifications } from '@/components/admin/RealtimeNotifications';
import { AIAdminAssistant } from '@/components/admin/AIAdminAssistant';
import { formatUSD } from '@/lib/formatCurrency';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';

// Dashboard Components
import { SummaryCard } from '@/components/admin/dashboard/SummaryCard';
import { OrdersOverviewChart } from '@/components/admin/dashboard/OrdersOverviewChart';
import { ConversionFunnel } from '@/components/admin/dashboard/ConversionFunnel';
import { PendingActionsSidebar } from '@/components/admin/dashboard/PendingActionsSidebar';
import { ShippingMetrics } from '@/components/admin/dashboard/ShippingMetrics';
import { PaymentsBreakdown } from '@/components/admin/dashboard/PaymentsBreakdown';
import { SavedCartsReport } from '@/components/admin/dashboard/SavedCartsReport';

interface DashboardStats {
  totalOrders: number;
  paidOrders: number;
  pendingPayments: number;
  totalRevenue: number;
  serviceFees: number;
  // Trend data (compared to previous period)
  ordersTrend: number;
  revenueTrend: number;
}

export default function AdminDashboard() {
  const { language } = useLanguage();
  const t = getAdminTranslation(language);
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
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);

      const { data: allOrders, error } = await supabase
        .from('orders')
        .select('id, status, total_usd, service_fee_usd, payment_verified_at, created_at');

      if (error) throw error;

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

      // Current period orders (last 30 days)
      const currentPeriodOrders = allOrders?.filter(o => 
        new Date(o.created_at) >= thirtyDaysAgo
      ) || [];

      // Previous period orders (30-60 days ago)
      const previousPeriodOrders = allOrders?.filter(o => 
        new Date(o.created_at) >= sixtyDaysAgo && 
        new Date(o.created_at) < thirtyDaysAgo
      ) || [];

      // Total orders (excluding DRAFT)
      const totalOrders = allOrders?.filter(o => o.status !== 'DRAFT').length || 0;

      // Paid orders
      const paidOrdersList = allOrders?.filter(o => o.payment_verified_at) || [];
      const paidOrders = paidOrdersList.length;

      // Pending payments
      const pendingPayments = allOrders?.filter(o => o.status === 'PENDING_PAYMENT').length || 0;

      // Revenue
      const totalRevenue = paidOrdersList.reduce((sum, o) => sum + Number(o.total_usd || 0), 0);

      // Service fees
      const serviceFees = paidOrdersList.reduce((sum, o) => sum + Number(o.service_fee_usd || 0), 0);

      // Calculate trends
      const currentOrderCount = currentPeriodOrders.filter(o => o.status !== 'DRAFT').length;
      const previousOrderCount = previousPeriodOrders.filter(o => o.status !== 'DRAFT').length;
      const ordersTrend = previousOrderCount > 0 
        ? Math.round(((currentOrderCount - previousOrderCount) / previousOrderCount) * 100)
        : 0;

      const currentRevenue = currentPeriodOrders
        .filter(o => o.payment_verified_at)
        .reduce((sum, o) => sum + Number(o.total_usd || 0), 0);
      const previousRevenue = previousPeriodOrders
        .filter(o => o.payment_verified_at)
        .reduce((sum, o) => sum + Number(o.total_usd || 0), 0);
      const revenueTrend = previousRevenue > 0
        ? Math.round(((currentRevenue - previousRevenue) / previousRevenue) * 100)
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
      
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.dashboard.title}</h1>
        <p className="text-muted-foreground text-sm">Real-time business metrics and insights</p>
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
              trendLabel="vs last 30 days"
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
              trendLabel="vs last 30 days"
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
            <OrdersOverviewChart />
            <ConversionFunnel />
          </div>

          {/* D. Bottom Section - Operational Insights */}
          <div className="grid gap-6 md:grid-cols-3">
            <ShippingMetrics />
            <PaymentsBreakdown />
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
