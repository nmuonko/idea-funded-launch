import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Package, Truck, CheckCircle, Download, Search } from 'lucide-react';

export default function AdminShipping() {
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('ready');
  const { toast } = useToast();

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
        .select('*')
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

  const getTabIcon = (tab: string) => {
    switch (tab) {
      case 'ready': return <Package className="h-4 w-4" />;
      case 'transit': return <Truck className="h-4 w-4" />;
      case 'delivered': return <CheckCircle className="h-4 w-4" />;
      default: return null;
    }
  };

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
          <h1 className="text-3xl font-bold">Shipping Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Track and manage order shipments
          </p>
        </div>
        <Button onClick={exportToCSV} disabled={filteredOrders.length === 0}>
          <Download className="h-4 w-4 mr-2" />
          Export to CSV
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
                Ready to Ship
              </TabsTrigger>
              <TabsTrigger value="transit" className="flex items-center gap-2">
                <Truck className="h-4 w-4" />
                In Transit
              </TabsTrigger>
              <TabsTrigger value="delivered" className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Delivered
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
                      <TableHead>City</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Tracking</TableHead>
                      <TableHead>Carrier</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono text-xs">
                          {order.id.slice(0, 8)}...
                        </TableCell>
                        <TableCell>{getStatusBadge(order.status)}</TableCell>
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
    </div>
  );
}
