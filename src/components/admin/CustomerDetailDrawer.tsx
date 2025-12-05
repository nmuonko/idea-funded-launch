import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  User,
  Mail,
  Phone,
  MapPin,
  Globe,
  Calendar,
  Package,
  DollarSign,
  ShoppingBag,
  ExternalLink,
} from 'lucide-react';

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

interface Order {
  id: string;
  status: string;
  total_usd: number | null;
  total_cdf: number | null;
  created_at: string;
  item_count: number;
}

interface CustomerDetailDrawerProps {
  customer: CustomerProfile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const LANGUAGES: Record<string, string> = {
  fr: 'Français',
  en: 'English',
  sw: 'Kiswahili',
  ln: 'Lingala',
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground',
  PENDING_PAYMENT: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-500',
  PAID: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-500',
  PROCESSING: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-500',
  SHIPPED: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-500',
  READY_FOR_PICKUP: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-500',
  COMPLETED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-500',
  CANCELLED: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-500',
};

export function CustomerDetailDrawer({ customer, open, onOpenChange }: CustomerDetailDrawerProps) {
  const { language } = useLanguage();
  const t = getAdminTranslation(language);
  
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  useEffect(() => {
    if (customer && open) {
      loadCustomerOrders(customer.user_id);
    }
  }, [customer, open]);

  const loadCustomerOrders = async (userId: string) => {
    setLoadingOrders(true);
    try {
      const { data: orderData, error } = await supabase
        .from('orders')
        .select('id, status, total_usd, total_cdf, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Get item counts for each order
      const orderIds = orderData?.map(o => o.id) || [];
      const { data: itemCounts } = await supabase
        .from('order_items')
        .select('order_id')
        .in('order_id', orderIds);

      const countMap = new Map<string, number>();
      itemCounts?.forEach(item => {
        countMap.set(item.order_id, (countMap.get(item.order_id) || 0) + 1);
      });

      const ordersWithCounts: Order[] = (orderData || []).map(o => ({
        ...o,
        item_count: countMap.get(o.id) || 0,
      }));

      setOrders(ordersWithCounts);
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      setLoadingOrders(false);
    }
  };

  if (!customer) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {customer.full_name || t.customers?.noName || 'Unknown Customer'}
          </SheetTitle>
          <SheetDescription>
            {t.customers?.customerDetails || 'Customer profile and order history'}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-120px)] mt-6 pr-4">
          <div className="space-y-6">
            {/* Profile Information */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t.customers?.profileInfo || 'Profile Information'}
              </h3>
              
              <div className="grid gap-3">
                <div className="flex items-center gap-3">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{customer.email || '-'}</span>
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{customer.phone || '-'}</span>
                </div>
                <div className="flex items-start gap-3">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div className="text-sm">
                    <div>{customer.address || '-'}</div>
                    <div className="text-muted-foreground">
                      {customer.province && `${customer.province}, `}{customer.country || '-'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <Badge variant="outline">
                    {LANGUAGES[customer.language || 'fr'] || customer.language}
                  </Badge>
                </div>
                <div className="flex items-center gap-3">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    {t.customers?.memberSince || 'Member since'} {format(new Date(customer.created_at), 'MMM d, yyyy')}
                  </span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Stats */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t.customers?.statistics || 'Statistics'}
              </h3>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-muted/50 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <ShoppingBag className="h-4 w-4" />
                    <span className="text-xs">{t.customers?.totalOrders || 'Total Orders'}</span>
                  </div>
                  <p className="text-2xl font-bold">{customer.order_count}</p>
                </div>
                <div className="bg-muted/50 rounded-lg p-4">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <DollarSign className="h-4 w-4" />
                    <span className="text-xs">{t.customers?.totalSpent || 'Total Spent'}</span>
                  </div>
                  <p className="text-2xl font-bold">${customer.total_spent.toFixed(2)}</p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Order History */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t.customers?.orderHistory || 'Order History'}
              </h3>

              {loadingOrders ? (
                <div className="space-y-3">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="bg-muted/30 rounded-lg p-4">
                      <Skeleton className="h-4 w-24 mb-2" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  ))}
                </div>
              ) : orders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">{t.customers?.noOrders || 'No orders yet'}</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {orders.map(order => (
                    <div
                      key={order.id}
                      className="bg-muted/30 rounded-lg p-4 hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => window.open(`/admin/orders/${order.id}`, '_blank')}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">
                            #{order.id.slice(0, 8).toUpperCase()}
                          </span>
                          <ExternalLink className="h-3 w-3 text-muted-foreground" />
                        </div>
                        <Badge className={STATUS_COLORS[order.status] || 'bg-muted'}>
                          {order.status.replace('_', ' ')}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          {order.item_count} {order.item_count === 1 ? 'item' : 'items'} • {format(new Date(order.created_at), 'MMM d, yyyy')}
                        </span>
                        <span className="font-medium">
                          ${(order.total_usd || 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
