import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { formatUSD, formatCDF } from '@/lib/formatCurrency';
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
  ExternalLink,
  Mail
} from 'lucide-react';
import { OrderTimeline } from './OrderTimeline';
import { PaymentVerificationPanel } from './PaymentVerificationPanel';
import { AIAssistantPanel } from './AIAssistantPanel';
import { ProfitCalculator } from './ProfitCalculator';
import { SendOrderEmailDialog } from './SendOrderEmailDialog';

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
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
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
          profiles:user_id (
            user_id,
            name,
            full_name,
            email,
            phone
          ),
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
                <div className="space-y-1 text-sm">
                  <p><span className="font-medium">Name:</span> {order.profiles?.name || order.profiles?.full_name || 'N/A'}</p>
                  <p><span className="font-medium">Email:</span> {order.profiles?.email || 'N/A'}</p>
                  {order.profiles?.phone && (
                    <p><span className="font-medium">Phone:</span> {order.profiles.phone}</p>
                  )}
                  <p className="text-xs text-muted-foreground">User ID: {order.user_id}</p>
                </div>
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
                          <p className="font-semibold">{formatUSD(item.subtotal_usd)}</p>
                          <p className="text-xs text-muted-foreground">{formatUSD(item.unit_price_usd)} each</p>
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
                    <span>{formatUSD(order.item_total_usd)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Service Fee:</span>
                    <span>{formatUSD(order.service_fee_usd)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Shipping Fee:</span>
                    <span>{formatUSD(order.shipping_fee_usd)}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between font-semibold text-base">
                    <span>Total (USD):</span>
                    <span>{formatUSD(order.total_usd)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-base">
                    <span>Total (CDF):</span>
                    <span>{formatCDF(order.total_cdf)}</span>
                  </div>
                  {order.exchange_rate_used && (
                    <p className="text-xs text-muted-foreground">
                      Exchange Rate: 1 USD = {order.exchange_rate_used?.toLocaleString()} CDF
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
                      <Button
                        onClick={() => setEmailDialogOpen(true)}
                        variant="outline"
                        className="w-full"
                      >
                        <Mail className="h-4 w-4 mr-2" />
                        Send Email
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {order && (
              <SendOrderEmailDialog
                orderId={order.id}
                customerEmail={order.profiles?.email || ''}
                customerName={order.profiles?.name || order.profiles?.full_name || `User ${order.user_id.slice(0, 8)}`}
                open={emailDialogOpen}
                onClose={() => setEmailDialogOpen(false)}
              />
            )}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
