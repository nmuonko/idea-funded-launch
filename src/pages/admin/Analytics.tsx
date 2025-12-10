import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, DollarSign, Users, MapPin, ShoppingCart, TrendingUp, AlertCircle } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatUSD } from '@/lib/formatCurrency';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';

export default function AdminAnalytics() {
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('30');
  const [revenueData, setRevenueData] = useState<any[]>([]);
  const [cityData, setCityData] = useState<any[]>([]);
  const [storeData, setStoreData] = useState<any[]>([]);
  const [stats, setStats] = useState({
    totalRevenue: 0,
    paidOrders: 0,
    activeUsers: 0,
    averageOrderValue: 0,
  });
  const { toast } = useToast();
  const { language } = useLanguage();
  const t = getAdminTranslation(language);

  useEffect(() => {
    loadAnalytics();
  }, [dateRange]);

  const loadAnalytics = async () => {
    try {
      setLoading(true);
      
      const daysAgo = parseInt(dateRange);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysAgo);

      // Get ONLY paid orders (with payment_verified_at)
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .gte('created_at', startDate.toISOString())
        .not('payment_verified_at', 'is', null);

      if (ordersError) throw ordersError;

      // Get order items for store breakdown
      const orderIds = orders?.map(o => o.id) || [];
      let items: any[] = [];
      
      if (orderIds.length > 0) {
        const { data: orderItems } = await supabase
          .from('order_items')
          .select('store, base_price_usd, quantity')
          .in('order_id', orderIds);
        items = orderItems || [];
      }

      // Calculate revenue by day (ONLY from paid orders)
      const revenueByDay: Record<string, number> = {};
      const cityCount: Record<string, number> = {};
      let totalRevenue = 0;
      const uniqueUsers = new Set();

      orders?.forEach((order) => {
        const date = new Date(order.created_at).toLocaleDateString();
        revenueByDay[date] = (revenueByDay[date] || 0) + (order.total_usd || 0);
        
        if (order.shipping_city) {
          cityCount[order.shipping_city] = (cityCount[order.shipping_city] || 0) + 1;
        }
        
        totalRevenue += order.total_usd || 0;
        uniqueUsers.add(order.user_id);
      });

      // Calculate store breakdown
      const storeCount: Record<string, { count: number; value: number }> = {};
      items.forEach((item) => {
        const store = item.store || 'OTHER';
        if (!storeCount[store]) {
          storeCount[store] = { count: 0, value: 0 };
        }
        storeCount[store].count += item.quantity || 1;
        storeCount[store].value += (item.base_price_usd || 0) * (item.quantity || 1);
      });

      // Format data for charts
      const revenueChartData = Object.entries(revenueByDay)
        .map(([date, revenue]) => ({
          date,
          revenue: Number(revenue.toFixed(2))
        }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(-14);

      const cityChartData = Object.entries(cityCount)
        .map(([city, count]) => ({
          name: city,
          value: count
        }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);

      const storeChartData = Object.entries(storeCount)
        .map(([store, data]) => ({
          name: store,
          items: data.count,
          value: data.value
        }))
        .sort((a, b) => b.value - a.value);

      const paidOrders = orders?.length || 0;
      const averageOrderValue = paidOrders > 0 ? totalRevenue / paidOrders : 0;

      setRevenueData(revenueChartData);
      setCityData(cityChartData);
      setStoreData(storeChartData);
      setStats({
        totalRevenue,
        paidOrders,
        activeUsers: uniqueUsers.size,
        averageOrderValue,
      });
    } catch (error: any) {
      toast({
        title: 'Error loading analytics',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const COLORS = ['#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t.analytics.title}</h1>
          <p className="text-muted-foreground mt-2">
            {t.analytics.subtitle}
          </p>
        </div>
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder={t.analytics.selectRange} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">{t.analytics.last7Days}</SelectItem>
            <SelectItem value="30">{t.analytics.last30Days}</SelectItem>
            <SelectItem value="90">{t.analytics.last90Days}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Important Notice */}
      {stats.paidOrders === 0 && (
        <Card className="border-yellow-500/50 bg-yellow-500/10">
          <CardContent className="flex items-center gap-3 py-4">
            <AlertCircle className="h-5 w-5 text-yellow-600" />
            <p className="text-sm">
              {t.analytics.noPaidOrdersNotice}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t.analytics.totalRevenue}</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">
              {stats.paidOrders > 0 ? formatUSD(stats.totalRevenue) : '$0.00'}
            </div>
            <p className="text-xs text-muted-foreground">
              {t.analytics.paidOrders}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t.analytics.paidOrders}</CardTitle>
            <ShoppingCart className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.paidOrders}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t.analytics.activeCustomers}</CardTitle>
            <Users className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeUsers}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t.analytics.avgOrderValue}</CardTitle>
            <TrendingUp className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.paidOrders > 0 ? formatUSD(stats.averageOrderValue) : 'N/A'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Revenue Chart */}
      <Card>
        <CardHeader>
          <CardTitle>{t.analytics.revenueTrend}</CardTitle>
          <CardDescription>{t.analytics.dailyRevenueDesc}</CardDescription>
        </CardHeader>
        <CardContent>
          {revenueData.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-muted-foreground">
              {t.analytics.noRevenueData}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" className="text-xs" />
                <YAxis className="text-xs" />
                <Tooltip 
                  formatter={(value: number) => [`$${value.toFixed(2)}`, t.analytics.totalRevenue]}
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                />
                <Legend />
                <Line type="monotone" dataKey="revenue" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: '#8b5cf6' }} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Store & City Distribution */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t.analytics.salesByStore}</CardTitle>
            <CardDescription>{t.analytics.salesByStoreDesc}</CardDescription>
          </CardHeader>
          <CardContent>
            {storeData.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                {t.analytics.noStoreData}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={storeData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={80} className="text-xs" />
                  <Tooltip 
                    formatter={(value: number, name: string) => [
                      name === 'value' ? `$${value.toFixed(2)}` : value,
                      name === 'value' ? 'Revenue' : 'Items'
                    ]}
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                  />
                  <Bar dataKey="value" fill="#8b5cf6" name="Revenue" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.analytics.topCities}</CardTitle>
            <CardDescription>{t.analytics.topCitiesDesc}</CardDescription>
          </CardHeader>
          <CardContent>
            {cityData.length === 0 ? (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                {t.analytics.noCityData}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={cityData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {cityData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
