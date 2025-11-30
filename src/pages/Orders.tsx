import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Package, Clock, CheckCircle, XCircle, RefreshCw, ExternalLink } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

export default function Orders() {
  const { toast } = useToast();
  const navigate = useNavigate();
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
        title: 'Error',
        description: 'Failed to load orders',
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
          title: 'Payment Retry Initiated',
          description: 'Complete payment in the new window',
        });
      }
    } catch (error: any) {
      console.error('Error retrying payment:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to retry payment',
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

      // Add all items back to cart
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
        title: 'Items Added to Cart',
        description: `${order.order_items.length} items added to your cart`,
      });
    } catch (error: any) {
      console.error('Error reordering:', error);
      toast({
        title: 'Error',
        description: 'Failed to reorder items',
        variant: 'destructive',
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { icon: any; className: string; label: string }> = {
      'PENDING_PAYMENT': { icon: Clock, className: 'bg-yellow-500', label: 'Pending Payment' },
      'PAID': { icon: CheckCircle, className: 'bg-green-500', label: 'Paid' },
      'PROCESSING': { icon: Package, className: 'bg-blue-500', label: 'Processing' },
      'SHIPPED': { icon: Package, className: 'bg-purple-500', label: 'Shipped' },
      'READY_FOR_PICKUP': { icon: Package, className: 'bg-indigo-500', label: 'Ready' },
      'COMPLETED': { icon: CheckCircle, className: 'bg-emerald-500', label: 'Completed' },
      'CANCELLED': { icon: XCircle, className: 'bg-red-500', label: 'Cancelled' },
    };

    const config = statusMap[status] || { icon: Clock, className: 'bg-gray-500', label: status };
    const Icon = config.icon;

    return (
      <Badge className={config.className}>
        <Icon className="h-3 w-3 mr-1" />
        {config.label}
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
          <h1 className="text-3xl font-bold">My Orders</h1>
          <p className="text-muted-foreground">Track and manage your orders</p>
        </div>
        <Button onClick={loadOrders} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No orders yet</h3>
            <p className="text-muted-foreground mb-4">Start shopping to see your orders here</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <Card key={order.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">Order #{order.id.slice(0, 8)}</CardTitle>
                    <CardDescription>
                      {new Date(order.created_at).toLocaleDateString()} • {order.order_items?.length || 0} items
                    </CardDescription>
                  </div>
                  {getStatusBadge(order.status)}
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
                        <span className="text-muted-foreground">Tracking:</span>
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
                          <div className="flex-1">
                            <p className="font-medium line-clamp-1">{item.title || 'Product'}</p>
                            <p className="text-muted-foreground">Qty: {item.quantity}</p>
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
                          +{order.order_items.length - 2} more items
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    {(order.status === 'PENDING_PAYMENT' || order.maisha_payment_status === 'failed') && (
                      <Button 
                        onClick={() => retryPayment(order.id)}
                        disabled={retrying === order.id}
                        size="sm"
                      >
                        {retrying === order.id ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Processing...
                          </>
                        ) : (
                          'Retry Payment'
                        )}
                      </Button>
                    )}
                    <Button 
                      onClick={() => reorder(order.id)}
                      variant="outline"
                      size="sm"
                    >
                      Reorder
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
