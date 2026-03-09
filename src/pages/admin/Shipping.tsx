import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Package, Truck, CheckCircle, Download, Search, Mail, Calendar, DollarSign, MapPin } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';
import { formatOrderId } from '@/lib/formatOrderId';

export default function AdminShipping() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('ready');
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [updating, setUpdating] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [trackingNumber, setTrackingNumber] = useState('');
  const [carrier, setCarrier] = useState('');
  const [sendEmail, setSendEmail] = useState(true);
  const [estimatedDelivery, setEstimatedDelivery] = useState('');
  const [actualShippingCost, setActualShippingCost] = useState('');
  
  // Bulk selection state
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [bulkSendEmail, setBulkSendEmail] = useState(true);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  
  const { toast } = useToast();
  const { language } = useLanguage();
  const t = getAdminTranslation(language);

  useEffect(() => {
    loadOrders();
  }, [activeTab]);

  useEffect(() => {
    // Clear selection when tab changes
    setSelectedOrders(new Set());
  }, [activeTab]);

  const loadOrders = async () => {
    try {
      setLoading(true);
      
      type OrderStatus = 'CANCELLED' | 'COMPLETED' | 'DRAFT' | 'PAID' | 'PENDING_PAYMENT' | 'PROCESSING' | 'READY_FOR_PICKUP' | 'SHIPPED';
      let statusFilter: OrderStatus[] = [];
      
      switch (activeTab) {
        case 'ready':
          statusFilter = ['PAID', 'PROCESSING'];
          break;
        case 'transit':
          statusFilter = ['SHIPPED'];
          break;
        case 'pickup':
          statusFilter = ['READY_FOR_PICKUP'];
          break;
        case 'delivered':
          statusFilter = ['COMPLETED'];
          break;
      }

      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items(id, title, product_url, product_image_url),
          profiles:user_id(email, full_name)
        `)
        .in('status', statusFilter)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOrders(data || []);
    } catch (error: any) {
      toast({
        title: 'Error loading orders',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const openUpdateDialog = (order: any, e: React.MouseEvent) => {
    // Don't open dialog if clicking on checkbox
    if ((e.target as HTMLElement).closest('[data-checkbox]')) return;
    
    setSelectedOrder(order);
    setNewStatus(order.status);
    setTrackingNumber(order.tracking_number || '');
    setCarrier(order.carrier || '');
    setSendEmail(true);
    // Format existing estimated delivery date for the input
    setEstimatedDelivery(order.estimated_delivery ? order.estimated_delivery.split('T')[0] : '');
    setActualShippingCost(order.actual_shipping_cost_usd?.toString() || '');
  };

  const sendPushForOrder = async (order: any, status: string) => {
    if (!order.user_id) return;
    let title = '', body = '';
    switch (status) {
      case 'SHIPPED':
        title = '🚚 Commande expédiée';
        body = 'Votre commande a été expédiée!';
        break;
      case 'READY_FOR_PICKUP':
        title = '📦 Commande prête!';
        body = 'Votre commande est prête pour le ramassage.';
        break;
      case 'COMPLETED':
        title = '✅ Commande livrée';
        body = 'Votre commande a été livrée avec succès.';
        break;
    }
    if (title) {
      try {
        await supabase.functions.invoke('email-service', {
          body: { type: 'push_notification', userId: order.user_id, title, body },
        });
      } catch (e) {
        console.error('Push notification failed:', e);
      }
    }
  };

  const sendShippingEmail = async (order: any, status: string, tracking?: string, carrierName?: string, estDelivery?: string) => {
    try {
      const customerEmail = order.profiles?.email;
      const customerName = order.profiles?.full_name || 'Customer';
      
      if (!customerEmail) {
        console.warn('No customer email found for order:', order.id);
        return;
      }

      const items = order.order_items?.map((item: any) => ({
        title: item.title || 'Product',
        quantity: 1,
      })) || [];

      if (status === 'SHIPPED') {
        await supabase.functions.invoke('email-service', {
          body: {
            type: 'order_shipped',
            customerEmail,
            customerName,
            orderId: order.id,
            orderRef: order.id.slice(0, 8).toUpperCase(),
            trackingNumber: tracking || null,
            carrier: carrierName || null,
            estimatedDelivery: estDelivery || null,
            items,
          },
        });
      } else if (status === 'READY_FOR_PICKUP') {
        await supabase.functions.invoke('email-service', {
          body: {
            type: 'order_ready',
            customerEmail,
            customerName,
            orderId: order.id,
            items,
          },
        });
      } else if (status === 'COMPLETED') {
        await supabase.functions.invoke('email-service', {
          body: {
            type: 'order_delivered',
            customerEmail,
            customerName,
            orderId: order.id,
            orderRef: order.id.slice(0, 8).toUpperCase(),
            items,
          },
        });
      }
    } catch (error) {
      console.error('Failed to send shipping email:', error);
    }
  };

  const handleUpdateStatus = async () => {
    if (!selectedOrder) return;
    
    try {
      setUpdating(true);
      
      const updateData: any = {
        status: newStatus,
        tracking_number: trackingNumber || null,
        carrier: carrier || null,
        estimated_delivery: estimatedDelivery ? new Date(estimatedDelivery).toISOString() : null,
        actual_shipping_cost_usd: actualShippingCost ? parseFloat(actualShippingCost) : null,
      };

      if (newStatus === 'SHIPPED' && selectedOrder.status !== 'SHIPPED') {
        updateData.shipped_at = new Date().toISOString();
      }
      if (newStatus === 'COMPLETED' && selectedOrder.status !== 'COMPLETED') {
        updateData.delivered_at = new Date().toISOString();
      }

      const { error } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', selectedOrder.id);

      if (error) throw error;

      // Send email notification if enabled
      if (sendEmail && (newStatus === 'SHIPPED' || newStatus === 'READY_FOR_PICKUP' || newStatus === 'COMPLETED')) {
        await sendShippingEmail(selectedOrder, newStatus, trackingNumber, carrier, estimatedDelivery);
        await sendPushForOrder(selectedOrder, newStatus);
      }

      toast({
        title: 'Order updated',
        description: sendEmail 
          ? `Order status changed to ${newStatus} and customer notified` 
          : `Order status changed to ${newStatus}`,
      });

      setSelectedOrder(null);
      loadOrders();
    } catch (error: any) {
      toast({
        title: 'Error updating order',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setUpdating(false);
    }
  };

  const toggleOrderSelection = (orderId: string) => {
    const newSelection = new Set(selectedOrders);
    if (newSelection.has(orderId)) {
      newSelection.delete(orderId);
    } else {
      newSelection.add(orderId);
    }
    setSelectedOrders(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedOrders.size === filteredOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(filteredOrders.map(o => o.id)));
    }
  };

  const handleBulkUpdate = async () => {
    if (selectedOrders.size === 0 || !bulkStatus) return;
    
    try {
      setBulkUpdating(true);
      
      const ordersToUpdate = orders.filter(o => selectedOrders.has(o.id));
      let successCount = 0;
      let emailCount = 0;

      for (const order of ordersToUpdate) {
        const updateData: any = {
          status: bulkStatus,
        };

        if (bulkStatus === 'SHIPPED' && order.status !== 'SHIPPED') {
          updateData.shipped_at = new Date().toISOString();
        }
        if (bulkStatus === 'COMPLETED' && order.status !== 'COMPLETED') {
          updateData.delivered_at = new Date().toISOString();
        }

        const { error } = await supabase
          .from('orders')
          .update(updateData)
          .eq('id', order.id);

        if (!error) {
          successCount++;
          
          // Send email notification if enabled
          if (bulkSendEmail && (bulkStatus === 'SHIPPED' || bulkStatus === 'READY_FOR_PICKUP' || bulkStatus === 'COMPLETED')) {
            await sendShippingEmail(order, bulkStatus);
            await sendPushForOrder(order, bulkStatus);
            emailCount++;
          }
        }
      }

      toast({
        title: 'Bulk update complete',
        description: `Updated ${successCount} orders${emailCount > 0 ? `, ${emailCount} emails sent` : ''}`,
      });

      setBulkDialogOpen(false);
      setSelectedOrders(new Set());
      setBulkStatus('');
      loadOrders();
    } catch (error: any) {
      toast({
        title: 'Error updating orders',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setBulkUpdating(false);
    }
  };

  const exportToCSV = () => {
    const headers = ['Order ID', 'Status', 'Total USD', 'Shipping Charged', 'Actual Shipping Cost', 'Profit', 'City', 'Tracking', 'Carrier', 'Est. Delivery', 'Created'];
    const rows = filteredOrders.map(order => {
      const chargedShipping = order.shipping_fee_usd || 0;
      const actualCost = order.actual_shipping_cost_usd || 0;
      const profit = chargedShipping - actualCost;
      return [
        order.id,
        order.status,
        order.total_usd || 0,
        chargedShipping,
        actualCost,
        profit,
        order.shipping_city || '',
        order.tracking_number || '',
        order.carrier || '',
        order.estimated_delivery ? new Date(order.estimated_delivery).toLocaleDateString() : '',
        new Date(order.created_at).toLocaleDateString()
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shipping-${activeTab}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    toast({
      title: 'Export successful',
      description: `Downloaded ${filteredOrders.length} orders`,
    });
  };

  const filteredOrders = orders.filter(order =>
    order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    order.tracking_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    order.shipping_city?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Calculate shipping profit/loss summary
  const shippingSummary = filteredOrders.reduce((acc, order) => {
    acc.totalCharged += Number(order.shipping_fee_usd || 0);
    acc.totalActual += Number(order.actual_shipping_cost_usd || 0);
    if (order.actual_shipping_cost_usd) acc.trackedCount++;
    return acc;
  }, { totalCharged: 0, totalActual: 0, trackedCount: 0 });

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PAID: 'bg-green-600',
      PROCESSING: 'bg-blue-600',
      SHIPPED: 'bg-purple-600',
      READY_FOR_PICKUP: 'bg-amber-600',
      COMPLETED: 'bg-green-700',
    };
    return <Badge className={colors[status] || 'bg-gray-600'}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t.sidebar.shipping}</h1>
          <p className="text-muted-foreground mt-2">
            {t.shipping.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedOrders.size > 0 && (
            <Button onClick={() => setBulkDialogOpen(true)}>
              Update {selectedOrders.size} Selected
            </Button>
          )}
          <Button onClick={exportToCSV} disabled={filteredOrders.length === 0} variant="outline">
            <Download className="h-4 w-4 mr-2" />
            {t.common.export}
          </Button>
        </div>
      </div>

      {/* Shipping Cost Summary */}
      {shippingSummary.trackedCount > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Shipping Charged</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${shippingSummary.totalCharged.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground">{filteredOrders.length} orders</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Actual Shipping Cost</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${shippingSummary.totalActual.toFixed(2)}</div>
              <p className="text-xs text-muted-foreground">{shippingSummary.trackedCount} tracked</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Shipping Profit</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${shippingSummary.totalCharged - shippingSummary.totalActual >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                ${(shippingSummary.totalCharged - shippingSummary.totalActual).toFixed(2)}
              </div>
              <p className="text-xs text-muted-foreground">
                {((shippingSummary.totalCharged - shippingSummary.totalActual) / (shippingSummary.totalActual || 1) * 100).toFixed(1)}% margin
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Shipments</CardTitle>
              <CardDescription>{filteredOrders.length} orders</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search orders, tracking..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-[300px]"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="ready" className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                {t.shipping.readyToShip}
              </TabsTrigger>
              <TabsTrigger value="transit" className="flex items-center gap-2">
                <Truck className="h-4 w-4" />
                {t.shipping.inTransit}
              </TabsTrigger>
              <TabsTrigger value="pickup" className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                {language === 'fr' ? 'Ramassage' : 'Pickup'}
              </TabsTrigger>
              <TabsTrigger value="delivered" className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                {t.shipping.delivered}
              </TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="mt-6">
              {loading ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No orders found
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">
                        <Checkbox
                          checked={selectedOrders.size === filteredOrders.length && filteredOrders.length > 0}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead>Order ID</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>City</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Ship Cost</TableHead>
                      <TableHead>Tracking</TableHead>
                      <TableHead>Est. Delivery</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders.map((order) => (
                      <TableRow 
                        key={order.id} 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={(e) => openUpdateDialog(order, e)}
                      >
                        <TableCell data-checkbox>
                          <Checkbox
                            checked={selectedOrders.has(order.id)}
                            onCheckedChange={() => toggleOrderSelection(order.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {formatOrderId(order.id, order.profiles?.full_name)}
                        </TableCell>
                        <TableCell>{getStatusBadge(order.status)}</TableCell>
                        <TableCell>
                          {order.order_items && order.order_items.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {order.order_items.slice(0, 1).map((item: any) => (
                                <span key={item.id} className="text-xs flex items-center gap-1">
                                  {item.product_image_url && (
                                    <img 
                                      src={item.product_image_url} 
                                      alt="" 
                                      className="h-4 w-4 object-cover rounded"
                                      onError={(e) => e.currentTarget.style.display = 'none'}
                                    />
                                  )}
                                  <span className="line-clamp-1">{item.title?.slice(0, 25) || 'Product'}</span>
                                </span>
                              ))}
                              {order.order_items.length > 1 && (
                                <span className="text-xs text-muted-foreground">+{order.order_items.length - 1} more</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">No items</span>
                          )}
                        </TableCell>
                        <TableCell>{order.shipping_city || 'N/A'}</TableCell>
                        <TableCell>${Number(order.total_usd || 0).toFixed(2)}</TableCell>
                        <TableCell>
                          <div className="text-xs">
                            <div>${Number(order.shipping_fee_usd || 0).toFixed(2)} charged</div>
                            {order.actual_shipping_cost_usd && (
                              <div className={order.shipping_fee_usd - order.actual_shipping_cost_usd >= 0 ? 'text-green-500' : 'text-red-500'}>
                                ${Number(order.actual_shipping_cost_usd).toFixed(2)} actual
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {order.tracking_number ? (
                            <div className="flex flex-col gap-1">
                              <span className="font-mono text-xs">{order.tracking_number}</span>
                              {order.carrier && <Badge variant="outline" className="text-[10px] w-fit">{order.carrier}</Badge>}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {order.estimated_delivery ? (
                            new Date(order.estimated_delivery).toLocaleDateString()
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Update Status Dialog */}
      <Dialog open={!!selectedOrder} onOpenChange={() => setSelectedOrder(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Update Shipment</DialogTitle>
            <DialogDescription>
              Order: {selectedOrder ? formatOrderId(selectedOrder.id, selectedOrder.profiles?.full_name) : ''}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PAID">Ready to Ship</SelectItem>
                  <SelectItem value="PROCESSING">Processing</SelectItem>
                  <SelectItem value="SHIPPED">In Transit</SelectItem>
                  <SelectItem value="READY_FOR_PICKUP">Ready for Pickup</SelectItem>
                  <SelectItem value="COMPLETED">Delivered</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Tracking Number</Label>
                <Input
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="Enter tracking #"
                />
              </div>
              <div className="space-y-2">
                <Label>Carrier</Label>
                <Select value={carrier} onValueChange={setCarrier}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select carrier" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DHL">DHL</SelectItem>
                    <SelectItem value="FedEx">FedEx</SelectItem>
                    <SelectItem value="UPS">UPS</SelectItem>
                    <SelectItem value="USPS">USPS</SelectItem>
                    <SelectItem value="Local">Local Courier</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Estimated Delivery
                </Label>
                <Input
                  type="date"
                  value={estimatedDelivery}
                  onChange={(e) => setEstimatedDelivery(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> Actual Shipping Cost
                </Label>
                <Input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={actualShippingCost}
                  onChange={(e) => setActualShippingCost(e.target.value)}
                />
              </div>
            </div>

            {selectedOrder && (
              <div className="text-xs text-muted-foreground bg-muted/50 p-2 rounded">
                <p>Charged to customer: ${Number(selectedOrder.shipping_fee_usd || 0).toFixed(2)}</p>
                {actualShippingCost && (
                  <p className={Number(selectedOrder.shipping_fee_usd || 0) - parseFloat(actualShippingCost) >= 0 ? 'text-green-500' : 'text-red-500'}>
                    Profit: ${(Number(selectedOrder.shipping_fee_usd || 0) - parseFloat(actualShippingCost)).toFixed(2)}
                  </p>
                )}
              </div>
            )}

            {(newStatus === 'SHIPPED' || newStatus === 'READY_FOR_PICKUP' || newStatus === 'COMPLETED') && (
              <div className="flex items-center space-x-2 pt-2 border-t">
                <Checkbox
                  id="sendEmail"
                  checked={sendEmail}
                  onCheckedChange={(checked) => setSendEmail(checked as boolean)}
                />
                <label htmlFor="sendEmail" className="text-sm flex items-center gap-2 cursor-pointer">
                  <Mail className="h-4 w-4" />
                  Notify customer via email &amp; push
                </label>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedOrder(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateStatus} disabled={updating}>
              {updating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Update Dialog */}
      <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bulk Update Shipments</DialogTitle>
            <DialogDescription>
              Update {selectedOrders.size} selected orders
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>New Status</Label>
              <Select value={bulkStatus} onValueChange={setBulkStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PROCESSING">Processing</SelectItem>
                  <SelectItem value="SHIPPED">In Transit (Shipped)</SelectItem>
                  <SelectItem value="READY_FOR_PICKUP">Ready for Pickup</SelectItem>
                  <SelectItem value="COMPLETED">Delivered</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(bulkStatus === 'SHIPPED' || bulkStatus === 'READY_FOR_PICKUP' || bulkStatus === 'COMPLETED') && (
              <div className="flex items-center space-x-2 pt-2 border-t">
                <Checkbox
                  id="bulkSendEmail"
                  checked={bulkSendEmail}
                  onCheckedChange={(checked) => setBulkSendEmail(checked as boolean)}
                />
                <label htmlFor="bulkSendEmail" className="text-sm flex items-center gap-2 cursor-pointer">
                  <Mail className="h-4 w-4" />
                  Send email &amp; push notifications to all customers
                </label>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkUpdate} disabled={bulkUpdating || !bulkStatus}>
              {bulkUpdating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Update {selectedOrders.size} Orders
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
