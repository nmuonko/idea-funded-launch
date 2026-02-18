import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Package, ArrowLeft, Loader2, ShoppingBag, ChevronRight, RefreshCw, Clock, CheckCircle } from 'lucide-react';
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

type OrderTab = 'all' | 'active' | 'past';

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  pending_payment: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  processing: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  paid: 'bg-green-500/20 text-green-400 border-green-500/30',
  shipped: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  delivered: 'bg-green-500/20 text-green-400 border-green-500/30',
  completed: 'bg-green-500/20 text-green-400 border-green-500/30',
  cancelled: 'bg-red-500/20 text-red-400 border-red-500/30',
};

// Active statuses (orders in progress)
const ACTIVE_STATUSES = ['PENDING', 'PENDING_PAYMENT', 'PAID', 'PROCESSING', 'SHIPPED'];
// Past statuses (completed or cancelled)
const PAST_STATUSES = ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED'];

export default function MyOrders() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = t.shop as any;
  
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<OrderTab>('all');

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
          .neq('status', 'DRAFT') // Exclude draft orders (carts)
          .order('created_at', { ascending: false })
          .limit(100);

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
    const statusLower = status.toLowerCase();
    const labels: Record<string, string> = {
      pending: shop?.statusPending || 'Pending',
      pending_payment: shop?.statusPending || 'Pending Payment',
      paid: shop?.statusPaid || 'Paid',
      processing: shop?.statusProcessing || 'Processing',
      shipped: shop?.statusShipped || 'Shipped',
      delivered: shop?.statusDelivered || 'Delivered',
      completed: shop?.statusDelivered || 'Completed',
      cancelled: shop?.statusCancelled || 'Cancelled',
    };
    return labels[statusLower] || status;
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

  // Filter orders by tab
  const filteredOrders = orders.filter(order => {
    if (activeTab === 'all') return true;
    const statusUpper = order.status.toUpperCase();
    if (activeTab === 'active') return ACTIVE_STATUSES.includes(statusUpper);
    return PAST_STATUSES.includes(statusUpper);
  });

  const allCount = orders.length;
  const activeCount = orders.filter(o => ACTIVE_STATUSES.includes(o.status.toUpperCase())).length;
  const pastCount = orders.filter(o => PAST_STATUSES.includes(o.status.toUpperCase())).length;

  return (
    <div className="min-h-screen bg-black pb-20">
      <ShopHeader />
      
      <main className="pt-20 px-4">
        <div className="container mx-auto max-w-4xl">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
             <Link to="/">
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
              <Link to="/shop-auth">
                <Button className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full px-6 mt-4">
                  {shop?.signIn || 'Sign In'}
                </Button>
              </Link>
            </motion.div>
          ) : loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-white/40" />
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div className="flex gap-2 mb-6">
                <button
                  onClick={() => setActiveTab('all')}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors",
                    activeTab === 'all'
                      ? "bg-gradient-to-r from-blue-500 to-cyan-500 text-white"
                      : "bg-white/10 text-white/60 hover:bg-white/20"
                  )}
                >
                  <Package className="h-4 w-4" />
                  {language === 'fr' ? 'Tous' : 'All'}
                  {allCount > 0 && (
                    <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">{allCount}</span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('active')}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors",
                    activeTab === 'active'
                      ? "bg-gradient-to-r from-blue-500 to-cyan-500 text-white"
                      : "bg-white/10 text-white/60 hover:bg-white/20"
                  )}
                >
                  <Clock className="h-4 w-4" />
                  {language === 'fr' ? 'En cours' : 'Active'}
                  {activeCount > 0 && (
                    <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">{activeCount}</span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('past')}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors",
                    activeTab === 'past'
                      ? "bg-gradient-to-r from-blue-500 to-cyan-500 text-white"
                      : "bg-white/10 text-white/60 hover:bg-white/20"
                  )}
                >
                  <CheckCircle className="h-4 w-4" />
                  {language === 'fr' ? 'Historique' : 'Past Orders'}
                  {pastCount > 0 && (
                    <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">{pastCount}</span>
                  )}
                </button>
              </div>

              {filteredOrders.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-center py-20"
                >
                  <ShoppingBag className="h-16 w-16 text-white/20 mx-auto mb-4" />
                  <h2 className="text-xl font-semibold text-white mb-2">
                    {activeTab === 'all'
                      ? (language === 'fr' ? 'Aucune commande' : 'No orders yet')
                      : activeTab === 'active' 
                        ? (language === 'fr' ? 'Aucune commande en cours' : 'No active orders')
                        : (language === 'fr' ? 'Aucune commande passée' : 'No past orders')}
                  </h2>
                  <p className="text-white/60 mb-6">
                    {activeTab === 'all'
                      ? (language === 'fr' ? 'Vos commandes apparaîtront ici' : 'Your orders will appear here')
                      : activeTab === 'active'
                        ? (language === 'fr' ? 'Vos commandes actives apparaîtront ici' : 'Your active orders will appear here')
                        : (language === 'fr' ? 'Votre historique de commandes apparaîtra ici' : 'Your order history will appear here')}
                  </p>
                  <Link to="/">
                    <Button className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full px-6">
                      {shop?.startShopping || 'Start Shopping'}
                    </Button>
                  </Link>
                </motion.div>
              ) : (
                <div className="space-y-4">
                  {filteredOrders.map((order, index) => (
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
                                className={cn("text-xs capitalize", statusColors[order.status.toLowerCase()] || statusColors.pending)}
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
            </>
          )}
        </div>
      </main>

      <BottomNavigation />
    </div>
  );
}
