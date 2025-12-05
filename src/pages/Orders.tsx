import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Package, Clock, CheckCircle, XCircle, RefreshCw, ExternalLink, Eye } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { getStatusTranslation, getTranslation } from '@/lib/i18n/translations';

export default function Orders() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const t = getTranslation(language);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState<string | null>(null);

  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        navigate('/auth');
        return;
      }

      const { data, error } = await supabase
        .from('orders')
        .select('*, order_items(*), maisha_payments(*)')
        .eq('user_id', user.id)
        .neq('status', 'DRAFT')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOrders(data || []);
    } catch (error) {
      console.error('Error loading orders:', error);
      toast({
        title: t.common.error,
        description: language === 'fr' ? 'Échec du chargement des commandes' : 'Failed to load orders',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const retryPayment = async (orderId: string) => {
    try {
      setRetrying(orderId);
      const { data, error } = await supabase.functions.invoke('mobile-retry-payment/' + orderId);

      if (error) throw error;

      if (data?.payment?.checkoutUrl) {
        window.open(data.payment.checkoutUrl, '_blank');
        toast({
          title: language === 'fr' ? 'Paiement relancé' : 'Payment Retry Initiated',
          description: language === 'fr' ? 'Complétez le paiement dans la nouvelle fenêtre' : 'Complete payment in the new window',
        });
      }
    } catch (error: any) {
      console.error('Error retrying payment:', error);
      toast({
        title: t.common.error,
        description: error.message || (language === 'fr' ? 'Échec de la relance du paiement' : 'Failed to retry payment'),
        variant: 'destructive',
      });
    } finally {
      setRetrying(null);
    }
  };

  const reorder = async (orderId: string) => {
    try {
      const order = orders.find(o => o.id === orderId);
      if (!order || !order.order_items) return;

      for (const item of order.order_items) {
        await supabase.functions.invoke('mobile-add-cart-item', {
          body: {
            productUrl: item.product_url,
            productPrice: item.base_price_usd,
            quantity: item.quantity,
            productTitle: item.title,
            productImageUrl: item.product_image_url,
          },
        });
      }

      toast({
        title: language === 'fr' ? 'Articles ajoutés au panier' : 'Items Added to Cart',
        description: language === 'fr' 
          ? `${order.order_items.length} articles ajoutés à votre panier`
          : `${order.order_items.length} items added to your cart`,
      });
    } catch (error: any) {
      console.error('Error reordering:', error);
      toast({
        title: t.common.error,
        description: language === 'fr' ? 'Échec de la recommande' : 'Failed to reorder items',
        variant: 'destructive',
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const statusIcons: Record<string, any> = {
      'PENDING_PAYMENT': Clock,
      'PAID': CheckCircle,
      'PROCESSING': Package,
      'SHIPPED': Package,
      'READY_FOR_PICKUP': Package,
      'COMPLETED': CheckCircle,
      'CANCELLED': XCircle,
    };

    const statusColors: Record<string, string> = {
      'PENDING_PAYMENT': 'bg-yellow-500',
      'PAID': 'bg-green-500',
      'PROCESSING': 'bg-blue-500',
      'SHIPPED': 'bg-purple-500',
      'READY_FOR_PICKUP': 'bg-indigo-500',
      'COMPLETED': 'bg-emerald-500',
      'CANCELLED': 'bg-red-500',
    };

    const Icon = statusIcons[status] || Clock;
    const colorClass = statusColors[status] || 'bg-gray-500';
    const label = getStatusTranslation(status, language);

    return (
      <Badge className={`${colorClass} text-xs whitespace-nowrap max-w-[140px] truncate`}>
        <Icon className="h-3 w-3 mr-1 flex-shrink-0" />
        <span className="truncate">{label}</span>
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="container mx-auto py-8 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">
            {language === 'fr' ? 'Mes commandes' : 'My Orders'}
          </h1>
          <p className="text-muted-foreground">
            {language === 'fr' ? 'Suivez et gérez vos commandes' : 'Track and manage your orders'}
          </p>
        </div>
        <Button onClick={loadOrders} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          {language === 'fr' ? 'Actualiser' : 'Refresh'}
        </Button>
      </div>

      {orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">
              {language === 'fr' ? 'Aucune commande' : 'No orders yet'}
            </h3>
            <p className="text-muted-foreground mb-4">
              {language === 'fr' 
                ? 'Commencez vos achats pour voir vos commandes ici'
                : 'Start shopping to see your orders here'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <Card key={order.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-lg truncate">
                      {language === 'fr' ? 'Commande' : 'Order'} #{order.id.slice(0, 8)}
                    </CardTitle>
                    <CardDescription>
                      {new Date(order.created_at).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-US')} • {order.order_items?.length || 0} {language === 'fr' ? 'articles' : 'items'}
                    </CardDescription>
                  </div>
                  <div className="flex-shrink-0">
                    {getStatusBadge(order.status)}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Total:</span>
                      <p className="font-semibold">
                        ${Number(order.total_usd || 0).toFixed(2)} / {Number(order.total_cdf || 0).toLocaleString()} CDF
                      </p>
                    </div>
                    {order.tracking_number && (
                      <div>
                        <span className="text-muted-foreground">
                          {language === 'fr' ? 'Suivi:' : 'Tracking:'}
                        </span>
                        <p className="font-mono text-xs">{order.tracking_number}</p>
                      </div>
                    )}
                  </div>

                  {order.order_items && order.order_items.length > 0 && (
                    <div className="space-y-2">
                      {order.order_items.slice(0, 2).map((item: any) => (
                        <div key={item.id} className="flex items-center gap-3 text-sm">
                          {item.product_image_url && (
                            <img 
                              src={item.product_image_url} 
                              alt="" 
                              className="h-12 w-12 object-cover rounded"
                              onError={(e) => e.currentTarget.style.display = 'none'}
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="font-medium line-clamp-1">{item.title || 'Product'}</p>
                            <p className="text-muted-foreground">
                              {language === 'fr' ? 'Qté:' : 'Qty:'} {item.quantity}
                            </p>
                          </div>
                          {item.product_url && (
                            <Button variant="ghost" size="sm" asChild>
                              <a href={item.product_url} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                        </div>
                      ))}
                      {order.order_items.length > 2 && (
                        <p className="text-sm text-muted-foreground">
                          +{order.order_items.length - 2} {language === 'fr' ? 'autres articles' : 'more items'}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button 
                      onClick={() => navigate(`/orders/${order.id}`)}
                      variant="outline"
                      size="sm"
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      {t.common.viewDetails}
                    </Button>
                    {(order.status === 'PENDING_PAYMENT' || order.maisha_payment_status === 'failed') && (
                      <Button 
                        onClick={() => retryPayment(order.id)}
                        disabled={retrying === order.id}
                        size="sm"
                      >
                        {retrying === order.id ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            {language === 'fr' ? 'Traitement...' : 'Processing...'}
                          </>
                        ) : (
                          language === 'fr' ? 'Réessayer le paiement' : 'Retry Payment'
                        )}
                      </Button>
                    )}
                    <Button 
                      onClick={() => reorder(order.id)}
                      variant="outline"
                      size="sm"
                    >
                      {language === 'fr' ? 'Recommander' : 'Reorder'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
