import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { 
  CheckCircle, 
  XCircle, 
  MessageSquare, 
  Loader2, 
  Package, 
  MapPin, 
  DollarSign, 
  Calendar,
  User,
  ExternalLink
} from 'lucide-react';
import { OrderTimeline } from './OrderTimeline';
import { PaymentVerificationPanel } from './PaymentVerificationPanel';
import { AIAssistantPanel } from './AIAssistantPanel';

interface OrderDetailsDrawerProps {
  orderId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdate: () => void;
}

export function OrderDetailsDrawer({ orderId, open, onClose, onUpdate }: OrderDetailsDrawerProps) {
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    if (orderId && open) {
      loadOrderDetails();
    }
  }, [orderId, open]);

  const loadOrderDetails = async () => {
    try {
      setLoading(true);
      
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            id,
            title,
            product_url,
            quantity,
            unit_price_usd,
            subtotal_usd,
            notes,
            store
          )
        `)
        .eq('id', orderId)
        .single();

      if (error) throw error;
      setOrder(data);
    } catch (error: any) {
      toast({
        title: 'Error loading order',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const performAction = async (actionType: string) => {
    if (!orderId) return;

    try {
      setActionLoading(true);
      
      const { error } = await supabase.functions.invoke('admin-order-action', {
        body: {
          orderId,
          actionType,
          message: actionMessage,
          metadata: {}
        }
      });

      if (error) throw error;

      toast({
        title: 'Action completed',
        description: `Order ${actionType.toLowerCase()} successfully`,
      });

      setActionMessage('');
      loadOrderDetails();
      onUpdate();
    } catch (error: any) {
      toast({
        title: 'Action failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
    }
  };

  if (!order && !loading) return null;

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      DRAFT: 'bg-gray-500',
      PENDING_PAYMENT: 'bg-yellow-500',
      PAID: 'bg-green-500',
      PROCESSING: 'bg-blue-500',
      SHIPPED: 'bg-purple-500',
      COMPLETED: 'bg-green-600',
      CANCELLED: 'bg-red-500',
    };
    return colors[status] || 'bg-gray-500';
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : order ? (
          <>
            <SheetHeader>
              <SheetTitle>Order Details</SheetTitle>
              <SheetDescription>
                Order ID: {order.id}
              </SheetDescription>
            </SheetHeader>

            <div className="space-y-6 mt-6">
              {/* Status */}
              <div>
                <h3 className="text-sm font-semibold mb-2">Status</h3>
                <Badge className={getStatusColor(order.status)}>
                  {order.status}
                </Badge>
              </div>

              <Separator />

              {/* Customer Info */}
              <div>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Customer Information
                </h3>
                <p className="text-sm text-muted-foreground">User ID: {order.user_id}</p>
              </div>

              <Separator />

              {/* Delivery City */}
              {order.shipping_city && (
                <>
                  <div>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <MapPin className="h-4 w-4" />
                      Delivery City
                    </h3>
                    <p className="text-sm">{order.shipping_city}</p>
                  </div>
                  <Separator />
                </>
              )}

              {/* Order Items */}
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Order Items
                </h3>
                <div className="space-y-3">
                  {order.order_items?.map((item: any) => (
                    <div key={item.id} className="border rounded-lg p-3 space-y-2">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <p className="font-medium text-sm">{item.title || 'Product'}</p>
                          <p className="text-xs text-muted-foreground">Store: {item.store}</p>
                          <p className="text-xs text-muted-foreground">Quantity: {item.quantity}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">${item.subtotal_usd?.toFixed(2)}</p>
                          <p className="text-xs text-muted-foreground">${item.unit_price_usd?.toFixed(2)} each</p>
                        </div>
                      </div>
                      {item.product_url && (
                        <a 
                          href={item.product_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                        >
                          View Product <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {item.notes && (
                        <p className="text-xs bg-muted p-2 rounded">{item.notes}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <Separator />

              {/* Cost Breakdown */}
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Cost Breakdown
                </h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span>Items Total:</span>
                    <span>${order.item_total_usd?.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Service Fee:</span>
                    <span>${order.service_fee_usd?.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Shipping Fee:</span>
                    <span>${order.shipping_fee_usd?.toFixed(2)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-semibold text-base">
                    <span>Total (USD):</span>
                    <span>${order.total_usd?.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-base">
                    <span>Total (CDF):</span>
                    <span>{order.total_cdf?.toFixed(0)} FC</span>
                  </div>
                  {order.exchange_rate_used && (
                    <p className="text-xs text-muted-foreground">
                      Exchange Rate: 1 USD = {order.exchange_rate_used} CDF
                    </p>
                  )}
                </div>
              </div>

              <Separator />

              {/* Payment Verification */}
              <PaymentVerificationPanel order={order} onUpdate={loadOrderDetails} />

              <Separator />

              {/* AI Assistant */}
              <AIAssistantPanel order={order} />

              <Separator />
              <div>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Order Timeline
                </h3>
                <p className="text-xs text-muted-foreground mb-3">
                  Created: {new Date(order.created_at).toLocaleString()}
                </p>
                <OrderTimeline orderId={order.id} />
              </div>

              <Separator />

              {/* Admin Actions */}
              {order.status !== 'CANCELLED' && order.status !== 'COMPLETED' && (
                <div>
                  <h3 className="text-sm font-semibold mb-3">Admin Actions</h3>
                  <div className="space-y-3">
                    <Textarea
                      placeholder="Add a message or note..."
                      value={actionMessage}
                      onChange={(e) => setActionMessage(e.target.value)}
                      className="min-h-[80px]"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        onClick={() => performAction('APPROVED')}
                        disabled={actionLoading}
                        className="w-full"
                      >
                        {actionLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <CheckCircle className="h-4 w-4 mr-2" />
                            Approve
                          </>
                        )}
                      </Button>
                      <Button
                        onClick={() => performAction('REJECTED')}
                        disabled={actionLoading}
                        variant="destructive"
                        className="w-full"
                      >
                        {actionLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <XCircle className="h-4 w-4 mr-2" />
                            Reject
                          </>
                        )}
                      </Button>
                      <Button
                        onClick={() => performAction('INFO_REQUESTED')}
                        disabled={actionLoading}
                        variant="outline"
                        className="w-full"
                      >
                        {actionLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <MessageSquare className="h-4 w-4 mr-2" />
                            Request Info
                          </>
                        )}
                      </Button>
                      <Button
                        onClick={() => performAction('NOTE_ADDED')}
                        disabled={actionLoading || !actionMessage}
                        variant="outline"
                        className="w-full"
                      >
                        Add Note
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
