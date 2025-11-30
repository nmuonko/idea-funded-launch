import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { DollarSign, Package, TrendingUp, Users } from 'lucide-react';
import { RealtimeNotifications } from '@/components/admin/RealtimeNotifications';
import { PendingActionsWidget } from '@/components/admin/PendingActionsWidget';

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    totalOrders: 0,
    totalRevenue: 0,
    totalServiceFees: 0,
    paidOrders: 0,
    pendingPayments: 0,
    avgOrderValue: 0,
  });

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      // Get all orders
      const { data: orders, error } = await supabase
        .from('orders')
        .select('*');

      if (error) throw error;

      const totalOrders = orders?.length || 0;
      const paidOrders = orders?.filter(o => o.payment_verified_at).length || 0;
      const pendingPayments = orders?.filter(o => !o.payment_verified_at && o.status !== 'DRAFT').length || 0;
      
      const totalRevenue = orders
        ?.filter(o => o.payment_verified_at)
        .reduce((sum, o) => sum + Number(o.total_usd || 0), 0) || 0;
      
      const totalServiceFees = orders
        ?.filter(o => o.payment_verified_at)
        .reduce((sum, o) => sum + Number(o.service_fee_usd || 0), 0) || 0;
      
      const avgOrderValue = paidOrders > 0 ? totalRevenue / paidOrders : 0;

      setStats({
        totalOrders,
        totalRevenue,
        totalServiceFees,
        paidOrders,
        pendingPayments,
        avgOrderValue,
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    }
  };

  return (
    <div className="space-y-6">
      <RealtimeNotifications />
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">AfriShop Admin Portal</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
                <Package className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stats.totalOrders}</div>
                <p className="text-xs text-muted-foreground">All orders</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Paid Orders</CardTitle>
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-emerald-600">{stats.paidOrders}</div>
                <p className="text-xs text-muted-foreground">Verified payments</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${stats.totalRevenue.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">From paid orders</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Pending Payments</CardTitle>
                <Users className="h-4 w-4 text-yellow-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600">{stats.pendingPayments}</div>
                <p className="text-xs text-muted-foreground">Awaiting payment</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Service Fees</CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${stats.totalServiceFees.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">Platform earnings</p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Order Value</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">${stats.avgOrderValue.toFixed(2)}</div>
                <p className="text-xs text-muted-foreground">Per paid order</p>
              </CardContent>
            </Card>
          </div>
        </div>

        <div>
          <PendingActionsWidget />
        </div>
      </div>
    </div>
  );
}
