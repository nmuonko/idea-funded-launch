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
import { useToast } from '@/hooks/use-toast';
import { Loader2, Package, Truck, CheckCircle, Download, Search } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';

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
  const { toast } = useToast();
  const { language } = useLanguage();
  const t = getAdminTranslation(language);

  useEffect(() => {
    loadOrders();
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
        case 'delivered':
          statusFilter = ['COMPLETED'];
          break;
      }

      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items(id, title, product_url, product_image_url)
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

  const openUpdateDialog = (order: any) => {
    setSelectedOrder(order);
    setNewStatus(order.status);
    setTrackingNumber(order.tracking_number || '');
    setCarrier(order.carrier || '');
  };

  const handleUpdateStatus = async () => {
    if (!selectedOrder) return;
    
    try {
      setUpdating(true);
      
      const updateData: any = {
        status: newStatus,
        tracking_number: trackingNumber || null,
        carrier: carrier || null,
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

      toast({
        title: 'Order updated',
        description: `Order status changed to ${newStatus}`,
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

  const exportToCSV = () => {
    const headers = ['Order ID', 'Status', 'Total USD', 'City', 'Tracking', 'Carrier', 'Created'];
    const rows = filteredOrders.map(order => [
      order.id,
      order.status,
      order.total_usd || 0,
      order.shipping_city || '',
      order.tracking_number || '',
      order.carrier || '',
      new Date(order.created_at).toLocaleDateString()
    ]);

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

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PAID: 'bg-green-600',
      PROCESSING: 'bg-blue-600',
      SHIPPED: 'bg-purple-600',
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
        <Button onClick={exportToCSV} disabled={filteredOrders.length === 0}>
          <Download className="h-4 w-4 mr-2" />
          {t.common.export}
        </Button>
      </div>

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
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="ready" className="flex items-center gap-2">
                <Package className="h-4 w-4" />
                {t.shipping.readyToShip}
              </TabsTrigger>
              <TabsTrigger value="transit" className="flex items-center gap-2">
                <Truck className="h-4 w-4" />
                {t.shipping.inTransit}
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
                      <TableHead>Order ID</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>City</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Tracking</TableHead>
                      <TableHead>Carrier</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders.map((order) => (
                      <TableRow 
                        key={order.id} 
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => openUpdateDialog(order)}
                      >
                        <TableCell className="font-mono text-xs">
                          {order.id.slice(0, 8)}...
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
                          {order.tracking_number ? (
                            <span className="font-mono text-xs">{order.tracking_number}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {order.carrier ? (
                            <Badge variant="outline">{order.carrier}</Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {new Date(order.created_at).toLocaleDateString()}
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update Shipment</DialogTitle>
            <DialogDescription>
              Order: {selectedOrder?.id.slice(0, 8)}...
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
                  <SelectItem value="COMPLETED">Delivered</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Tracking Number</Label>
              <Input
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="Enter tracking number"
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
    </div>
  );
}
