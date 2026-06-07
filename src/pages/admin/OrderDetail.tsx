import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { getAdminOrderProductLink } from '@/lib/orderProductLinks';
import { Loader2, Send, FileText, Package, Truck, CheckCircle2, Play, Mail, HelpCircle, ChevronDown } from 'lucide-react';
import { ImageLightbox } from '@/components/admin/ImageLightbox';
import { OrderTimelineComponent } from '@/components/admin/OrderTimelineComponent';
import { IssueRefundDialog } from '@/components/admin/IssueRefundDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export default function AdminOrderDetail() {
  const { id } = useParams();
  const { toast } = useToast();
  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt: string } | null>(null);
  const [refundDialogOpen, setRefundDialogOpen] = useState(false);
  const [sendingShipping, setSendingShipping] = useState(false);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [updatingItems, setUpdatingItems] = useState(false);
  const [sendingStatusEmail, setSendingStatusEmail] = useState<string | null>(null);
  const [sendingAssistanceEmail, setSendingAssistanceEmail] = useState(false);

  useEffect(() => {
    if (id) loadOrder();
  }, [id]);

  const loadOrder = async () => {
    try {
      setLoading(true);
      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .select(`
          *,
          profiles(name, email, phone)
        `)
        .eq('id', id)
        .maybeSingle();

      if (orderError) throw orderError;

      const { data: itemsData, error: itemsError } = await supabase
        .from('order_items')
        .select('*')
        .eq('order_id', id);

      if (itemsError) throw itemsError;

      setOrder(orderData);
      setItems(itemsData || []);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const sendPushNotification = async (title: string, body: string) => {
    if (!order?.user_id) return;
    try {
      await supabase.functions.invoke('email-service', {
        body: { type: 'push_notification', userId: order.user_id, title, body },
      });
    } catch (e) {
      console.error('Push notification failed:', e);
    }
  };

  const handleStatusUpdate = async (newStatus: string, sendEmail: boolean = false) => {
    try {
      setUpdating(true);
      if (sendEmail) setSendingStatusEmail(newStatus);

      const { error } = await supabase
        .from('orders')
        .update({ status: newStatus as any })
        .eq('id', id);

      if (error) throw error;

      // If shipping a deposit-plan order with a pending balance, also fire the reminder email.
      if (newStatus === 'SHIPPED' && order?.payment_plan === 'deposit' && order?.balance_status === 'pending') {
        try {
          const { error: remErr } = await supabase.functions.invoke('send-balance-reminder', {
            body: { order_id: id },
          });
          if (remErr) console.warn('[admin/OrderDetail] balance reminder failed:', remErr.message);
        } catch (e) {
          console.warn('[admin/OrderDetail] balance reminder threw:', e);
        }
      }


      // Send email notification based on status
      if (sendEmail && order?.profiles?.email) {
        const emailPayload = {
          orderId: id,
          customerEmail: order.profiles.email,
          customerName: order.profiles.name || 'Customer',
          items: items.map(i => ({ title: i.title || 'Product', quantity: i.quantity })),
          trackingNumber: order.tracking_number,
          carrier: order.carrier,
        };

        let emailType = '';
        let pushTitle = '';
        let pushBody = '';
        switch (newStatus) {
          case 'PROCESSING':
            emailType = 'order_processing';
            pushTitle = '🔄 Commande en cours';
            pushBody = 'Votre commande est en cours de traitement.';
            break;
          case 'SHIPPED':
            emailType = 'order_shipped';
            pushTitle = '🚚 Commande expédiée';
            pushBody = 'Votre commande a été expédiée!';
            break;
          case 'READY_FOR_PICKUP':
            emailType = 'order_ready';
            pushTitle = '📦 Commande prête!';
            pushBody = 'Votre commande est prête pour le ramassage.';
            break;
          case 'COMPLETED':
            emailType = 'order_delivered';
            pushTitle = '✅ Commande livrée';
            pushBody = 'Votre commande a été livrée avec succès.';
            await supabase.functions.invoke('email-service', {
              body: {
                type: emailType,
                orderId: id,
                customerEmail: order.profiles.email,
                customerName: order.profiles.name || 'Customer',
                items: items.map(i => ({ title: i.title || 'Product', quantity: i.quantity })),
              },
            });
            break;
        }

        if (emailType && newStatus !== 'COMPLETED') {
          await supabase.functions.invoke('email-service', { body: { type: emailType, ...emailPayload } });
        }

        // Send push notification
        if (pushTitle) {
          await sendPushNotification(pushTitle, pushBody);
        }

        toast({
          title: 'Success',
          description: `Order updated to ${newStatus} and notification sent to customer`,
        });
      } else {
        toast({
          title: 'Success',
          description: 'Order status updated successfully',
        });
      }

      loadOrder();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setUpdating(false);
      setSendingStatusEmail(null);
    }
  };

  const handleItemStatusUpdate = async (itemId: string, newStatus: string, sendEmail: boolean = false) => {
    try {
      setUpdatingItems(true);
      
      const { data, error } = await supabase.functions.invoke('admin-service', {
        body: {
          action: 'update_item_status',
          item_id: itemId,
          shipping_status: newStatus,
          send_email: sendEmail,
        },
      });

      if (error) throw error;

      toast({
        title: 'Success',
        description: data.message,
      });

      loadOrder();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setUpdatingItems(false);
    }
  };

  const handleBulkItemStatusUpdate = async (newStatus: string, sendEmail: boolean = false) => {
    if (selectedItems.size === 0) return;

    try {
      setUpdatingItems(true);
      
      // Update items one by one (could be optimized to batch)
      for (const itemId of selectedItems) {
        await supabase.functions.invoke('admin-service', {
          body: {
            action: 'update_item_status',
            item_id: itemId,
            shipping_status: newStatus,
            send_email: false,
          },
        });
      }

      // Send single email if requested
      if (sendEmail && order?.profiles?.email) {
        const updatedItems = items.filter(i => selectedItems.has(i.id));
        const emailType = newStatus === 'shipped' ? 'order_shipped' : 'order_delivered';
        
        await supabase.functions.invoke('email-service', {
          body: {
            orderId: id,
            type: emailType,
            customerEmail: order.profiles.email,
            customerName: order.profiles.name || 'Customer',
            items: updatedItems.map(i => ({
              title: i.title,
              quantity: i.quantity,
            })),
            trackingNumber: order.tracking_number,
            carrier: order.carrier,
          },
        });
      }

      toast({
        title: 'Success',
        description: `Updated ${selectedItems.size} item(s) to ${newStatus}`,
      });

      setSelectedItems(new Set());
      loadOrder();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setUpdatingItems(false);
    }
  };

  const handleSendShippingNotification = async () => {
    try {
      setSendingShipping(true);
      const { error } = await supabase.functions.invoke('email-service', {
        body: {
          type: 'shipping_notification',
          orderId: id,
          trackingNumber: order?.tracking_number,
          carrier: order?.carrier,
        },
      });

      if (error) throw error;

      toast({
        title: 'Notification Sent',
        description: 'Shipping notification sent to customer',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSendingShipping(false);
    }
  };

  const handleDownloadReceipt = async () => {
    try {
      setDownloadingReceipt(true);
      
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      const receiptUrl = `${SUPABASE_URL}/functions/v1/generate-payment-receipt?order_id=${id}`;
      
      const response = await fetch(receiptUrl, {
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to generate receipt');
      }

      const html = await response.text();
      
      const newWindow = window.open('', '_blank');
      if (newWindow) {
        newWindow.document.write(html);
        newWindow.document.close();
      }

      toast({
        title: 'Receipt Generated',
        description: 'Receipt opened in new tab',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setDownloadingReceipt(false);
    }
  };

  const toggleSelectItem = (itemId: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItems(newSelected);
  };

  const handleSendAssistanceEmail = async (language: string) => {
    try {
      setSendingAssistanceEmail(true);
      const { data, error } = await supabase.functions.invoke('email-service', {
        body: { type: 'order_assistance', orderId: id, language },
      });

      if (error) throw error;

      const languageLabels: Record<string, string> = {
        en: 'English',
        fr: 'French',
        sw: 'Swahili',
        ln: 'Lingala',
        en_sw: 'English + Swahili',
      };

      toast({
        title: 'Email Sent',
        description: `Assistance email sent in ${languageLabels[language] || language}`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to send assistance email',
        variant: 'destructive',
      });
    } finally {
      setSendingAssistanceEmail(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedItems.size === items.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(items.map(i => i.id)));
    }
  };

  const getShippingStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="gap-1"><Package className="h-3 w-3" /> Pending</Badge>;
      case 'shipped':
        return <Badge className="bg-blue-600 gap-1"><Truck className="h-3 w-3" /> Shipped</Badge>;
      case 'delivered':
        return <Badge className="bg-green-600 gap-1"><CheckCircle2 className="h-3 w-3" /> Delivered</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const isPaidOrder = order?.status === 'PAID' || 
                      order?.status === 'PROCESSING' || 
                      order?.status === 'SHIPPED' || 
                      order?.status === 'READY_FOR_PICKUP' || 
                      order?.status === 'COMPLETED';

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!order) return <div>Order not found</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Order Details</h1>
        <p className="text-muted-foreground font-mono">{order.id}</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Customer Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <strong>Name:</strong> {order.profiles?.name || 'N/A'}
            </div>
            <div>
              <strong>Email:</strong> {order.profiles?.email}
            </div>
            <div>
              <strong>Phone:</strong> {order.profiles?.phone || 'N/A'}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Order Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <strong>Status:</strong>{' '}
              <Select value={order.status} onValueChange={(v) => handleStatusUpdate(v, false)} disabled={updating}>
                <SelectTrigger className="w-[200px] inline-flex">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PENDING_PAYMENT">Pending Payment</SelectItem>
                  <SelectItem value="PAID">Paid</SelectItem>
                  <SelectItem value="PROCESSING">Processing</SelectItem>
                  <SelectItem value="SHIPPED">Shipped</SelectItem>
                  <SelectItem value="READY_FOR_PICKUP">Ready for Pickup</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  
                </SelectContent>
              </Select>
            </div>
            <div>
              <strong>Shipping City:</strong> {order.shipping_city || 'N/A'}
            </div>
            <div>
              <strong>Created:</strong> {new Date(order.created_at).toLocaleString()}
            </div>
            <div>
              <strong>Payment Transaction:</strong> {order.operator_ref_id || 'N/A'}
            </div>

            {/* Quick Status Actions with Email Notifications - Always show for any order */}
            <div className="pt-4 border-t">
              <p className="text-sm font-medium text-muted-foreground mb-3">Quick Actions (updates status + sends customer email)</p>
              <div className="flex flex-wrap gap-2">
                {/* Start Processing - show for PAID orders */}
                {(order.status === 'PAID' || order.status === 'PENDING_PAYMENT') && (
                  <Button
                    onClick={() => handleStatusUpdate('PROCESSING', true)}
                    disabled={updating || sendingStatusEmail === 'PROCESSING'}
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700"
                  >
                    {sendingStatusEmail === 'PROCESSING' ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-2" />
                    )}
                    Start Processing + Notify
                  </Button>
                )}
                
                {/* Mark as Shipped - show for PAID or PROCESSING */}
                {(order.status === 'PAID' || order.status === 'PROCESSING' || order.status === 'PENDING_PAYMENT') && (
                  <Button
                    onClick={() => handleStatusUpdate('SHIPPED', true)}
                    disabled={updating || sendingStatusEmail === 'SHIPPED'}
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    {sendingStatusEmail === 'SHIPPED' ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Truck className="h-4 w-4 mr-2" />
                    )}
                    Mark Shipped + Notify
                  </Button>
                )}
                
                {/* Mark as Ready for Pickup - show for SHIPPED */}
                {(order.status === 'SHIPPED') && (
                  <Button
                    onClick={() => handleStatusUpdate('READY_FOR_PICKUP', true)}
                    disabled={updating || sendingStatusEmail === 'READY_FOR_PICKUP'}
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-700"
                  >
                    {sendingStatusEmail === 'READY_FOR_PICKUP' ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Package className="h-4 w-4 mr-2" />
                    )}
                    Ready for Pickup + Notify
                  </Button>
                )}

                {/* Mark as Delivered - show for SHIPPED or READY_FOR_PICKUP */}
                {(order.status === 'SHIPPED' || order.status === 'READY_FOR_PICKUP' || order.status === 'PROCESSING' || order.status === 'PAID') && (
                  <Button
                    onClick={() => handleStatusUpdate('COMPLETED', true)}
                    disabled={updating || sendingStatusEmail === 'COMPLETED'}
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                  >
                    {sendingStatusEmail === 'COMPLETED' ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                    )}
                    Mark Delivered + Notify
                  </Button>
                )}

                {order.status === 'COMPLETED' && (
                  <Badge variant="outline" className="gap-1 text-green-600 border-green-600">
                    <CheckCircle2 className="h-3 w-3" /> Order Completed
                  </Badge>
                )}

                {/* Need Help dropdown for incomplete orders */}
                {(order.status === 'DRAFT' || order.status === 'PENDING_PAYMENT') && order.profiles?.email && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        disabled={sendingAssistanceEmail}
                        size="sm"
                        variant="outline"
                        className="border-blue-500 text-blue-600 hover:bg-blue-50"
                      >
                        {sendingAssistanceEmail ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <HelpCircle className="h-4 w-4 mr-2" />
                        )}
                        Need Help?
                        <ChevronDown className="h-4 w-4 ml-1" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="bg-background">
                      <DropdownMenuItem onClick={() => handleSendAssistanceEmail('en')}>
                        🇬🇧 Send in English
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleSendAssistanceEmail('fr')}>
                        🇫🇷 Send in French
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleSendAssistanceEmail('sw')}>
                        🇹🇿 Send in Swahili
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleSendAssistanceEmail('ln')}>
                        🇨🇩 Send in Lingala
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleSendAssistanceEmail('en_sw')}>
                        🇬🇧+🇹🇿 English + Swahili
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
            
            <div className="flex flex-wrap gap-2 pt-4 border-t">
              {isPaidOrder && (
                <Button
                  variant="outline"
                  onClick={handleDownloadReceipt}
                  disabled={downloadingReceipt}
                  size="sm"
                >
                  {downloadingReceipt ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileText className="h-4 w-4 mr-2" />
                  )}
                  View Receipt
                </Button>
              )}
              {(order.status === 'PAID' || order.status === 'PROCESSING') && (
                <Button
                  variant="destructive"
                  onClick={() => setRefundDialogOpen(true)}
                  size="sm"
                >
                  Process Refund
                </Button>
              )}
              {order.status === 'SHIPPED' && (
                <Button
                  variant="outline"
                  onClick={handleSendShippingNotification}
                  disabled={sendingShipping}
                  size="sm"
                >
                  {sendingShipping ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Resend Tracking Email
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Order Items</CardTitle>
              <CardDescription>
                {selectedItems.size > 0 ? `${selectedItems.size} item(s) selected` : `${items.length} item(s)`}
              </CardDescription>
            </div>
            {selectedItems.size > 0 && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleBulkItemStatusUpdate('shipped', true)}
                  disabled={updatingItems}
                >
                  <Truck className="h-4 w-4 mr-1" />
                  Mark Shipped + Email
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleBulkItemStatusUpdate('delivered', true)}
                  disabled={updatingItems}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Mark Delivered + Email
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">
                  <Checkbox 
                    checked={selectedItems.size === items.length && items.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Store / ID</TableHead>
                <TableHead>Product Link</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit Price</TableHead>
                <TableHead>Subtotal</TableHead>
                <TableHead>Shipping Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Checkbox 
                      checked={selectedItems.has(item.id)}
                      onCheckedChange={() => toggleSelectItem(item.id)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {item.product_image_url ? (
                        <img 
                          src={item.product_image_url} 
                          alt={item.title || 'Product'} 
                          className="h-12 w-12 object-cover rounded border cursor-pointer hover:opacity-80 transition-opacity"
                          onClick={() => setLightboxImage({ src: item.product_image_url, alt: item.title || 'Product' })}
                          onError={(e) => {
                            e.currentTarget.src = 'https://placehold.co/48x48?text=No+Image';
                          }}
                        />
                      ) : (
                        <div className="h-12 w-12 bg-muted rounded border flex items-center justify-center text-xs text-muted-foreground">
                          No Image
                        </div>
                      )}
                      <div className="max-w-[200px]">
                        <div className="font-medium text-sm line-clamp-2">{item.title || 'N/A'}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <Badge>{item.store}</Badge>
                      {item.provider_product_id && (
                        <button
                          onClick={() => navigator.clipboard.writeText(item.provider_product_id)}
                          className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded cursor-pointer hover:bg-accent w-fit"
                          title={`Click to copy ${item.store === 'AMAZON' ? 'ASIN' : 'ID'}`}
                        >
                          {item.store === 'AMAZON' ? 'ASIN' : 'ID'}: {item.provider_product_id}
                        </button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {getAdminOrderProductLink(item) ? (
                      <a 
                        href={getAdminOrderProductLink(item)!} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-primary hover:underline inline-flex items-center gap-1 text-sm"
                      >
                        View Product
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    ) : (
                      <span className="text-muted-foreground">N/A</span>
                    )}
                  </TableCell>
                  <TableCell>{item.quantity}</TableCell>
                  <TableCell>${Number(item.unit_price_usd || 0).toFixed(2)}</TableCell>
                  <TableCell>${Number(item.subtotal_usd || 0).toFixed(2)}</TableCell>
                  <TableCell>
                    <Select 
                      value={item.shipping_status || 'pending'} 
                      onValueChange={(value) => handleItemStatusUpdate(item.id, value, false)}
                      disabled={updatingItems}
                    >
                      <SelectTrigger className="w-[140px]">
                        {getShippingStatusBadge(item.shipping_status || 'pending')}
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">
                          <span className="flex items-center gap-2"><Package className="h-3 w-3" /> Pending</span>
                        </SelectItem>
                        <SelectItem value="shipped">
                          <span className="flex items-center gap-2"><Truck className="h-3 w-3" /> Shipped</span>
                        </SelectItem>
                        <SelectItem value="delivered">
                          <span className="flex items-center gap-2"><CheckCircle2 className="h-3 w-3" /> Delivered</span>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Order Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between">
            <span>Item Total:</span>
            <span>${Number(order.item_total_usd || 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Service Fee ({((Number(order.service_fee_usd) / Number(order.item_total_usd)) * 100).toFixed(0) || 0}%):</span>
            <span>${Number(order.service_fee_usd || 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Shipping Fee:</span>
            <span>${Number(order.shipping_fee_usd || 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-bold text-lg border-t pt-2">
            <span>Total (USD):</span>
            <span>${Number(order.total_usd || 0).toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-bold text-lg">
            <span>Total (CDF):</span>
            <span>{Number(order.total_cdf || 0).toFixed(0)} FC (@ {Number(order.exchange_rate_used || 0)})</span>
          </div>
        </CardContent>
      </Card>

      <OrderTimelineComponent orderId={id!} />

      <IssueRefundDialog
        order={order}
        open={refundDialogOpen}
        onOpenChange={setRefundDialogOpen}
        onSuccess={loadOrder}
      />

      {lightboxImage && (
        <ImageLightbox
          src={lightboxImage.src}
          alt={lightboxImage.alt}
          open={!!lightboxImage}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  );
}
