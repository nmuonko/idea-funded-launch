import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { DollarSign, Package, TrendingUp, Clock, Percent, ShoppingCart } from 'lucide-react';
import { RealtimeNotifications } from '@/components/admin/RealtimeNotifications';
import { PendingActionsWidget } from '@/components/admin/PendingActionsWidget';
import { CartConversionWidget } from '@/components/admin/CartConversionWidget';
import { AIAdminAssistant } from '@/components/admin/AIAdminAssistant';
import { formatUSD } from '@/lib/formatCurrency';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';

export default function AdminDashboard() {
  const { language } = useLanguage();
  const t = getAdminTranslation(language);
  const [stats, setStats] = useState({
    totalOrders: 0,
    totalRevenue: 0,
    totalServiceFees: 0,
    paidOrders: 0,
    pendingOrders: 0,
    avgOrderValue: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      
      // Get all orders (excluding DRAFT for total count to show meaningful orders)
      const { data: allOrders, error: allError } = await supabase
        .from('orders')
        .select('id, status, total_usd, service_fee_usd, payment_verified_at');

      if (allError) throw allError;

      // Total orders = ALL records in orders table
      const totalOrders = allOrders?.length || 0;
      
      // Paid orders = orders with payment_verified_at set (payment confirmed)
      const paidOrdersList = allOrders?.filter(o => o.payment_verified_at) || [];
      const paidOrders = paidOrdersList.length;
      
      // Pending orders = PENDING_PAYMENT, DRAFT (active carts), or orders awaiting verification
      const pendingOrders = allOrders?.filter(o => 
        o.status === 'PENDING_PAYMENT' || 
        o.status === 'DRAFT' ||
        (!o.payment_verified_at && o.status !== 'CANCELLED')
      ).length || 0;
      
      // Revenue = sum of total_usd for PAID orders only
      const totalRevenue = paidOrdersList.reduce((sum, o) => sum + Number(o.total_usd || 0), 0);
      
      // Service fees = sum of service_fee_usd for PAID orders only
      const totalServiceFees = paidOrdersList.reduce((sum, o) => sum + Number(o.service_fee_usd || 0), 0);
      
      // Avg order value = Revenue / Paid Orders (or 0 if no paid orders)
      const avgOrderValue = paidOrders > 0 ? totalRevenue / paidOrders : 0;

      setStats({
        totalOrders,
        totalRevenue,
        totalServiceFees,
        paidOrders,
        pendingOrders,
        avgOrderValue,
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const StatCard = ({ 
    title, 
    value, 
    icon: Icon, 
    iconColor = 'text-muted-foreground',
    subtitle,
    isLoading 
  }: { 
    title: string; 
    value: string | number; 
    icon: any;
    iconColor?: string;
    subtitle?: string;
    isLoading?: boolean;
  }) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${iconColor}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${iconColor !== 'text-muted-foreground' ? iconColor : ''}`}>
          {isLoading ? '...' : value}
        </div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-6">
      <RealtimeNotifications />
      <div>
        <h1 className="text-3xl font-bold">{t.dashboard.title}</h1>
        <p className="text-muted-foreground">AfriShop Admin Portal - Real-time metrics</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Primary Metrics */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <StatCard
              title={t.dashboard.totalOrders}
              value={stats.totalOrders}
              icon={Package}
              subtitle="All orders in database"
              isLoading={loading}
            />
            
            <StatCard
              title="Paid Orders"
              value={stats.paidOrders}
              icon={TrendingUp}
              iconColor="text-emerald-600"
              subtitle="Verified payments"
              isLoading={loading}
            />
            
            <StatCard
              title={t.dashboard.revenue}
              value={formatUSD(stats.totalRevenue)}
              icon={DollarSign}
              iconColor="text-primary"
              subtitle="From paid orders only"
              isLoading={loading}
            />
            
            <StatCard
              title={t.dashboard.pendingOrders}
              value={stats.pendingOrders}
              icon={Clock}
              iconColor="text-yellow-600"
              subtitle="Awaiting payment/verification"
              isLoading={loading}
            />
            
            <StatCard
              title="Service Fees"
              value={formatUSD(stats.totalServiceFees)}
              icon={Percent}
              subtitle="From paid orders only"
              isLoading={loading}
            />
            
            <StatCard
              title="Avg Order Value"
              value={stats.paidOrders > 0 ? formatUSD(stats.avgOrderValue) : 'N/A'}
              icon={ShoppingCart}
              subtitle={stats.paidOrders > 0 ? "Revenue ÷ Paid Orders" : "No paid orders yet"}
              isLoading={loading}
            />
          </div>
        </div>

        <div className="space-y-6">
          <PendingActionsWidget />
          <CartConversionWidget />
        </div>
      </div>

      {/* AI Assistant - Floating */}
      <AIAdminAssistant floating />
    </div>
  );
}
