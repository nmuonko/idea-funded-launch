import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Package, ArrowLeft, Loader2, ShoppingBag, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';
import { cn } from '@/lib/utils';

interface Order {
  id: string;
  created_at: string;
  status: string;
  total_usd: number;
  items: any[];
  confirmation_code?: string;
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  processing: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  shipped: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  delivered: 'bg-green-500/20 text-green-400 border-green-500/30',
  cancelled: 'bg-red-500/20 text-red-400 border-red-500/30',
};

export default function MyOrders() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = t.shop as any;
  
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrders = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('orders')
          .select('id, created_at, status, total_usd, confirmation_code')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(50);

        if (error) throw error;
        // Map data to include items as empty array since we don't query it
        setOrders((data || []).map((order: any) => ({ ...order, items: [] })));
      } catch (err) {
        console.error('Failed to fetch orders:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, [user]);

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: shop?.statusPending || 'Pending',
      processing: shop?.statusProcessing || 'Processing',
      shipped: shop?.statusShipped || 'Shipped',
      delivered: shop?.statusDelivered || 'Delivered',
      cancelled: shop?.statusCancelled || 'Cancelled',
    };
    return labels[status] || status;
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // Calculate items count from order
  const getItemsCount = (items: any[]) => {
    if (!Array.isArray(items)) return 0;
    return items.reduce((sum, item) => sum + (item.quantity || 1), 0);
  };

  return (
    <div className="min-h-screen bg-black pb-20">
      <ShopHeader />
      
      <main className="pt-20 px-4">
        <div className="container mx-auto max-w-4xl">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <Link to="/shop">
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/10">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Package className="h-6 w-6" />
              {shop?.myOrders || 'My Orders'}
            </h1>
          </div>

          {!user ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-20"
            >
              <Package className="h-16 w-16 text-white/20 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-white mb-2">
                {shop?.signInToViewOrders || 'Sign in to view your orders'}
              </h2>
              <Link to="/auth">
                <Button className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full px-6 mt-4">
                  {shop?.signIn || 'Sign In'}
                </Button>
              </Link>
            </motion.div>
          ) : loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-white/40" />
            </div>
          ) : orders.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-20"
            >
              <ShoppingBag className="h-16 w-16 text-white/20 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-white mb-2">
                {shop?.noOrders || 'No orders yet'}
              </h2>
              <p className="text-white/60 mb-6">
                {shop?.noOrdersDescription || 'Your orders will appear here after you make a purchase'}
              </p>
              <Link to="/shop">
                <Button className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full px-6">
                  {shop?.startShopping || 'Start Shopping'}
                </Button>
              </Link>
            </motion.div>
          ) : (
            <div className="space-y-4">
              {orders.map((order, index) => (
                <motion.div
                  key={order.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <Link
                    to={`/orders/${order.id}`}
                    className="block bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-white">
                            #{order.confirmation_code || order.id.slice(0, 8).toUpperCase()}
                          </span>
                          <Badge 
                            variant="outline" 
                            className={cn("text-xs capitalize", statusColors[order.status] || statusColors.pending)}
                          >
                            {getStatusLabel(order.status)}
                          </Badge>
                        </div>
                        
                        <p className="text-xs text-white/50 mb-2">
                          {formatDate(order.created_at)}
                        </p>
                        
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-white/60">
                            {getItemsCount(order.items)} {getItemsCount(order.items) === 1 ? shop?.item : shop?.items}
                          </span>
                          <span className="text-lg font-bold text-white">
                            ${order.total_usd?.toFixed(2) || '0.00'}
                          </span>
                        </div>
                      </div>
                      
                      <ChevronRight className="h-5 w-5 text-white/40 flex-shrink-0" />
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </main>

      <BottomNavigation />
    </div>
  );
}
