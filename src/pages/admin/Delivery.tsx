import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Package, CheckCircle2, MapPin, RefreshCw } from 'lucide-react';

const sendPushNotification = async (userId: string, title: string, body: string) => {
  try {
    await supabase.functions.invoke('email-service', {
      body: { type: 'push_notification', userId, title, body },
    });
  } catch (e) {
    console.error('Push notification failed:', e);
  }
};

export default function AdminDelivery() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => { loadOrders(); }, []);

  const loadOrders = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items(id, title, quantity),
          profiles:user_id(email, full_name)
        `)
        .in('status', ['SHIPPED', 'READY_FOR_PICKUP'] as any)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOrders(data || []);
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleMarkReady = async (order: any) => {
    try {
      setUpdatingId(order.id);
      
      const { error } = await supabase
        .from('orders')
        .update({ status: 'READY_FOR_PICKUP' as any })
        .eq('id', order.id);
      if (error) throw error;

      // Send email
      const items = order.order_items?.map((i: any) => ({ title: i.title || 'Product', quantity: i.quantity })) || [];
      await supabase.functions.invoke('email-service', {
        body: {
          type: 'order_ready',
          orderId: order.id,
          customerEmail: order.profiles?.email,
          customerName: order.profiles?.full_name || 'Customer',
          items,
        },
      });

      // Push notification
      if (order.user_id) {
        await sendPushNotification(order.user_id, '📦 Commande prête!', 'Votre commande est prête pour le ramassage.');
      }

      toast({ title: 'Succès', description: 'Commande marquée prête pour le ramassage' });
      loadOrders();
    } catch (error: any) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } finally {
      setUpdatingId(null);
    }
  };

  const handleMarkDelivered = async (order: any) => {
    try {
      setUpdatingId(order.id);
      
      const { error } = await supabase
        .from('orders')
        .update({ status: 'COMPLETED' as any, delivered_at: new Date().toISOString() })
        .eq('id', order.id);
      if (error) throw error;

      // Send email
      await supabase.functions.invoke('email-service', {
        body: {
          type: 'order_delivered',
          orderId: order.id,
          customerEmail: order.profiles?.email,
          customerName: order.profiles?.full_name || 'Customer',
          items: order.order_items?.map((i: any) => ({ title: i.title || 'Product', quantity: i.quantity })) || [],
        },
      });

      // Push notification
      if (order.user_id) {
        await sendPushNotification(order.user_id, '✅ Commande livrée!', 'Votre commande a été livrée avec succès.');
      }

      toast({ title: 'Succès', description: 'Commande marquée comme livrée' });
      loadOrders();
    } catch (error: any) {
      toast({ title: 'Erreur', description: error.message, variant: 'destructive' });
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <MapPin className="h-8 w-8 text-primary" />
            Livraisons
          </h1>
          <p className="text-muted-foreground mt-1">
            Commandes en attente de ramassage ou livraison
          </p>
        </div>
        <Button variant="outline" onClick={loadOrders} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Actualiser
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      ) : orders.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">Aucune commande en attente</p>
            <p className="text-sm">Les commandes expédiées apparaîtront ici</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {orders.map((order) => (
            <Card key={order.id} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-mono">
                      #{order.id.slice(0, 8).toUpperCase()}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {order.profiles?.full_name || 'Client'} — {order.shipping_city || 'N/A'}
                    </p>
                  </div>
                  <Badge className={order.status === 'READY_FOR_PICKUP' ? 'bg-amber-600' : 'bg-blue-600'}>
                    {order.status === 'READY_FOR_PICKUP' ? '📦 Prêt' : '🚚 Expédié'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="text-sm">
                  {order.order_items?.slice(0, 3).map((item: any) => (
                    <div key={item.id} className="text-muted-foreground">
                      • {item.title?.slice(0, 50) || 'Produit'} (x{item.quantity})
                    </div>
                  ))}
                  {(order.order_items?.length || 0) > 3 && (
                    <div className="text-muted-foreground">+{order.order_items.length - 3} autres</div>
                  )}
                </div>

                <div className="flex gap-2 pt-2">
                  {order.status === 'SHIPPED' && (
                    <Button
                      onClick={() => handleMarkReady(order)}
                      disabled={updatingId === order.id}
                      className="flex-1 bg-amber-600 hover:bg-amber-700 h-12 text-base"
                    >
                      {updatingId === order.id ? (
                        <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      ) : (
                        <Package className="h-5 w-5 mr-2" />
                      )}
                      Prêt pour ramassage
                    </Button>
                  )}
                  <Button
                    onClick={() => handleMarkDelivered(order)}
                    disabled={updatingId === order.id}
                    className="flex-1 bg-green-600 hover:bg-green-700 h-12 text-base"
                  >
                    {updatingId === order.id ? (
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-5 w-5 mr-2" />
                    )}
                    Livré
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
