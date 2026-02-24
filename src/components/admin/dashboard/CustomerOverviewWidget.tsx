import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Users, ChevronRight, TrendingUp } from 'lucide-react';

interface CustomerSummary {
  user_id: string;
  full_name: string | null;
  email: string | null;
  country: string | null;
  order_count: number;
  total_spent: number;
}

async function fetchCustomerOverview() {
  // Get admin user IDs to exclude
  const { data: adminRoles } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'admin');
  const adminIds = new Set(adminRoles?.map(r => r.user_id) || []);

  // Get order stats - top spenders
  const { data: orderStats } = await supabase
    .from('orders')
    .select('user_id, total_usd')
    .in('status', ['PAID', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'READY_FOR_PICKUP'])
    .limit(500);

  const statsMap = new Map<string, { count: number; total: number }>();
  orderStats?.forEach(order => {
    if (adminIds.has(order.user_id)) return;
    const existing = statsMap.get(order.user_id) || { count: 0, total: 0 };
    existing.count += 1;
    existing.total += order.total_usd || 0;
    statsMap.set(order.user_id, existing);
  });

  const topUserIds = [...statsMap.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5)
    .map(([uid]) => uid);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  // Fetch profiles, total count, and new-this-month in parallel
  const [profilesRes, totalRes, newRes] = await Promise.all([
    topUserIds.length > 0
      ? supabase.from('profiles').select('user_id, full_name, email, country').in('user_id', topUserIds)
      : Promise.resolve({ data: [] as { user_id: string; full_name: string | null; email: string | null; country: string | null }[] }),
    supabase.from('profiles').select('user_id', { count: 'exact', head: true }),
    supabase.from('profiles').select('user_id', { count: 'exact', head: true }).gte('created_at', startOfMonth.toISOString()),
  ]);

  const profiles = (profilesRes.data || []) as { user_id: string; full_name: string | null; email: string | null; country: string | null }[];
  const profileMap = new Map(profiles.map(p => [p.user_id, p]));
  const customers: CustomerSummary[] = topUserIds.map(uid => {
    const p = profileMap.get(uid);
    const s = statsMap.get(uid)!;
    return {
      user_id: uid,
      full_name: p?.full_name || null,
      email: p?.email || null,
      country: p?.country || null,
      order_count: s.count,
      total_spent: s.total,
    };
  });

  return {
    customers,
    totalCustomers: (totalRes.count || 0) - (adminRoles?.length || 0),
    newThisMonth: newRes.count || 0,
  };
}

export function CustomerOverviewWidget() {
  const { language } = useLanguage();
  const t = getAdminTranslation(language);
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');

  const { data, isLoading: loading } = useQuery({
    queryKey: ['admin', 'customer-overview'],
    queryFn: fetchCustomerOverview,
    staleTime: 2 * 60 * 1000,
  });

  const customers = data?.customers || [];
  const totalCustomers = data?.totalCustomers || 0;
  const newThisMonth = data?.newThisMonth || 0;

  const filteredCustomers = searchTerm
    ? customers.filter(c => 
        c.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.email?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : customers;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            {t.customers?.title || 'Customers'}
          </CardTitle>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => navigate('/admin/customers')}
            className="text-xs"
          >
            {t.common?.viewAll || 'View All'}
            <ChevronRight className="h-3 w-3 ml-1" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quick Stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">{t.customers?.totalCustomers || 'Total'}</p>
            <p className="text-xl font-bold">{loading ? '-' : totalCustomers}</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <div className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3 text-emerald-500" />
              <p className="text-xs text-muted-foreground">{t.customers?.newThisMonth || 'New this month'}</p>
            </div>
            <p className="text-xl font-bold text-emerald-600">{loading ? '-' : newThisMonth}</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={t.customers?.searchPlaceholder || 'Search...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>

        {/* Top Customers List */}
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground font-medium">
            {t.customers?.topCustomers || 'Top Customers'}
          </p>
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between py-2">
                <div className="space-y-1">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-2 w-32" />
                </div>
                <Skeleton className="h-5 w-16" />
              </div>
            ))
          ) : filteredCustomers.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t.customers?.noCustomers || 'No customers found'}
            </p>
          ) : (
            filteredCustomers.map(customer => (
              <div 
                key={customer.user_id}
                className="flex items-center justify-between py-2 hover:bg-muted/30 rounded px-2 -mx-2 cursor-pointer transition-colors"
                onClick={() => navigate('/admin/customers')}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {customer.full_name || customer.email || 'Unknown'}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {customer.order_count} {customer.order_count === 1 ? 'order' : 'orders'} • {customer.country || '-'}
                  </p>
                </div>
                <Badge variant="secondary" className="ml-2 shrink-0">
                  ${customer.total_spent.toFixed(0)}
                </Badge>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
