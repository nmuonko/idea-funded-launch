import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Users, ShoppingBag, DollarSign, Globe, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

interface CustomerProfile {
  id: string;
  user_id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  address: string | null;
  country: string | null;
  province: string | null;
  language: string | null;
  created_at: string;
  order_count: number;
  total_spent: number;
  last_order_date: string | null;
}

const LANGUAGES = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
  { code: 'sw', label: 'Kiswahili' },
  { code: 'ln', label: 'Lingala' },
];

const COUNTRIES = [
  'DR Congo',
  'Congo-Brazzaville',
  'Kenya',
  'Uganda',
  'Tanzania',
  'Nigeria',
  'Ghana',
  'South Africa',
  'Cameroon',
  'Rwanda',
  'Burundi',
];

export default function Customers() {
  const { language } = useLanguage();
  const t = getAdminTranslation(language);
  
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [provinceFilter, setProvinceFilter] = useState<string>('all');
  const [languageFilter, setLanguageFilter] = useState<string>('all');

  const loadCustomers = async () => {
    setLoading(true);
    try {
      // Get all profiles (non-admin users)
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Get admin user IDs to exclude
      const { data: adminRoles } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'admin');

      const adminUserIds = new Set(adminRoles?.map(r => r.user_id) || []);

      // Filter out admin users
      const customerProfiles = profiles?.filter(p => !adminUserIds.has(p.user_id)) || [];

      // Get order stats for each customer
      const customerIds = customerProfiles.map(p => p.user_id);
      
      const { data: orderStats } = await supabase
        .from('orders')
        .select('user_id, total_usd, created_at')
        .in('user_id', customerIds)
        .in('status', ['PAID', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'READY_FOR_PICKUP']);

      // Calculate stats per customer
      const statsMap = new Map<string, { count: number; total: number; lastDate: string | null }>();
      orderStats?.forEach(order => {
        const existing = statsMap.get(order.user_id) || { count: 0, total: 0, lastDate: null };
        existing.count += 1;
        existing.total += order.total_usd || 0;
        if (!existing.lastDate || order.created_at > existing.lastDate) {
          existing.lastDate = order.created_at;
        }
        statsMap.set(order.user_id, existing);
      });

      const customersWithStats: CustomerProfile[] = customerProfiles.map(p => ({
        id: p.id,
        user_id: p.user_id,
        email: p.email,
        full_name: p.full_name,
        phone: p.phone,
        address: p.address,
        country: p.country,
        province: p.province,
        language: p.language,
        created_at: p.created_at,
        order_count: statsMap.get(p.user_id)?.count || 0,
        total_spent: statsMap.get(p.user_id)?.total || 0,
        last_order_date: statsMap.get(p.user_id)?.lastDate || null,
      }));

      setCustomers(customersWithStats);
    } catch (error) {
      console.error('Error loading customers:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  // Get unique provinces from customers
  const availableProvinces = [...new Set(customers.map(c => c.province).filter(Boolean))];

  // Filter customers
  const filteredCustomers = customers.filter(customer => {
    const matchesSearch = !searchTerm || 
      customer.full_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      customer.phone?.includes(searchTerm);
    
    const matchesCountry = countryFilter === 'all' || customer.country === countryFilter;
    const matchesProvince = provinceFilter === 'all' || customer.province === provinceFilter;
    const matchesLanguage = languageFilter === 'all' || customer.language === languageFilter;

    return matchesSearch && matchesCountry && matchesProvince && matchesLanguage;
  });

  // Stats
  const totalCustomers = customers.length;
  const totalOrders = customers.reduce((sum, c) => sum + c.order_count, 0);
  const totalRevenue = customers.reduce((sum, c) => sum + c.total_spent, 0);

  const getLanguageLabel = (code: string | null) => {
    return LANGUAGES.find(l => l.code === code)?.label || code || '-';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">{t.customers?.title || 'Customers'}</h1>
        <p className="text-muted-foreground">{t.customers?.subtitle || 'Manage customer profiles and view order history'}</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-primary/10">
                <Users className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t.customers?.totalCustomers || 'Total Customers'}</p>
                <p className="text-2xl font-bold">{totalCustomers}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-primary/10">
                <ShoppingBag className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t.customers?.totalOrders || 'Total Orders'}</p>
                <p className="text-2xl font-bold">{totalOrders}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-full bg-primary/10">
                <DollarSign className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t.customers?.totalRevenue || 'Total Revenue'}</p>
                <p className="text-2xl font-bold">${totalRevenue.toFixed(2)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>{t.customers?.customerList || 'Customer List'}</CardTitle>
          <CardDescription>{t.customers?.customerListDesc || 'View and filter all registered customers'}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t.customers?.searchPlaceholder || 'Search by name, email or phone...'}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={countryFilter} onValueChange={setCountryFilter}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder={t.customers?.country || 'Country'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.common?.all || 'All'}</SelectItem>
                {COUNTRIES.map(country => (
                  <SelectItem key={country} value={country}>{country}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={provinceFilter} onValueChange={setProvinceFilter}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue placeholder={t.customers?.province || 'Province'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.common?.all || 'All'}</SelectItem>
                {availableProvinces.map(province => (
                  <SelectItem key={province} value={province!}>{province}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={languageFilter} onValueChange={setLanguageFilter}>
              <SelectTrigger className="w-full md:w-[150px]">
                <Globe className="h-4 w-4 mr-2" />
                <SelectValue placeholder={t.customers?.language || 'Language'} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t.common?.all || 'All'}</SelectItem>
                {LANGUAGES.map(lang => (
                  <SelectItem key={lang.code} value={lang.code}>{lang.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={loadCustomers} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              {t.common?.refresh || 'Refresh'}
            </Button>
          </div>

          {/* Table */}
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.customers?.name || 'Name'}</TableHead>
                  <TableHead>{t.customers?.email || 'Email'}</TableHead>
                  <TableHead>{t.customers?.phone || 'Phone'}</TableHead>
                  <TableHead>{t.customers?.location || 'Location'}</TableHead>
                  <TableHead>{t.customers?.language || 'Language'}</TableHead>
                  <TableHead className="text-right">{t.customers?.orders || 'Orders'}</TableHead>
                  <TableHead className="text-right">{t.customers?.spent || 'Spent'}</TableHead>
                  <TableHead>{t.customers?.joined || 'Joined'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-36" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    </TableRow>
                  ))
                ) : filteredCustomers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      {t.customers?.noCustomers || 'No customers found'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCustomers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell className="font-medium">
                        {customer.full_name || '-'}
                      </TableCell>
                      <TableCell>{customer.email || '-'}</TableCell>
                      <TableCell>{customer.phone || '-'}</TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <div>{customer.province || '-'}</div>
                          <div className="text-muted-foreground">{customer.country || '-'}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {getLanguageLabel(customer.language)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {customer.order_count > 0 ? (
                          <Badge variant="secondary">{customer.order_count}</Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${customer.total_spent.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {format(new Date(customer.created_at), 'MMM d, yyyy')}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Results count */}
          <div className="text-sm text-muted-foreground">
            {t.common?.showing || 'Showing'} {filteredCustomers.length} {t.common?.of || 'of'} {totalCustomers} {t.customers?.customers || 'customers'}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}