import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { DollarSign, Package, TrendingUp, Users } from 'lucide-react';
import { RealtimeNotifications } from '@/components/admin/RealtimeNotifications';

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    totalOrders: 0,
    totalRevenue: 0,
    totalServiceFees: 0,
    paidOrders: 0,
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
      const paidOrders = orders?.filter(o => o.status === 'PAID' || o.status === 'COMPLETED').length || 0;
      const totalRevenue = orders
        ?.filter(o => o.status === 'PAID' || o.status === 'COMPLETED')
        .reduce((sum, o) => sum + Number(o.total_usd || 0), 0) || 0;
      const totalServiceFees = orders
        ?.filter(o => o.status === 'PAID' || o.status === 'COMPLETED')
        .reduce((sum, o) => sum + Number(o.service_fee_usd || 0), 0) || 0;

      setStats({
        totalOrders,
        totalRevenue,
        totalServiceFees,
        paidOrders,
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalOrders}</div>
            <p className="text-xs text-muted-foreground">
              {stats.paidOrders} paid
            </p>
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
            <CardTitle className="text-sm font-medium">Service Fees</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${stats.totalServiceFees.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">From completed orders</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Order Value</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${stats.paidOrders > 0 ? (stats.totalRevenue / stats.paidOrders).toFixed(2) : '0.00'}
            </div>
            <p className="text-xs text-muted-foreground">Per paid order</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
