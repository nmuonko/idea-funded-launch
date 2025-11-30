import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Eye } from 'lucide-react';
import { OrderDetailsDrawer } from '@/components/admin/OrderDetailsDrawer';

export default function AdminOrders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    loadOrders();
  }, [statusFilter]);

  const loadOrders = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('orders')
        .select(`
          *,
          profiles!inner(name, email),
          order_items(id, title, product_url, product_image_url, quantity)
        `)
        .order('created_at', { ascending: false });

      if (statusFilter !== 'ALL') {
        query = query.eq('status', statusFilter as any);
      }

      const { data, error } = await query;

      if (error) throw error;
      setOrders(data || []);
    } catch (error) {
      console.error('Error loading orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      DRAFT: 'secondary',
      PENDING_PAYMENT: 'default',
      PAID: 'default',
      PROCESSING: 'default',
      SHIPPED: 'default',
      READY_FOR_PICKUP: 'default',
      COMPLETED: 'default',
      CANCELLED: 'destructive',
    };
    return <Badge variant={colors[status] as any}>{status.replace(/_/g, ' ')}</Badge>;
  };

  const getPaymentBadge = (order: any) => {
    if (order.payment_verified_at) {
      return <Badge className="bg-emerald-600">Verified</Badge>;
    }
    if (order.status === 'DRAFT') {
      return <Badge variant="secondary">Draft</Badge>;
    }
    return <Badge variant="outline">Pending</Badge>;
  };

  const openOrderDetails = (orderId: string) => {
    setSelectedOrderId(orderId);
    setDrawerOpen(true);
  };

  const closeOrderDetails = () => {
    setDrawerOpen(false);
    setTimeout(() => setSelectedOrderId(null), 300);
  };

  return (
    <>
      <Card>
        <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Orders</CardTitle>
            <CardDescription>Manage all customer orders</CardDescription>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Orders</SelectItem>
              <SelectItem value="PENDING_PAYMENT">Pending Payment</SelectItem>
              <SelectItem value="PAID">Paid</SelectItem>
              <SelectItem value="PROCESSING">Processing</SelectItem>
              <SelectItem value="SHIPPED">Shipped</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Total (USD)</TableHead>
                <TableHead>Payment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell className="font-mono text-xs">
                    {order.id.slice(0, 8)}...
                  </TableCell>
                  <TableCell>
                    <div>
                      <div className="font-medium">{order.profiles?.name || 'N/A'}</div>
                      <div className="text-xs text-muted-foreground">{order.profiles?.email}</div>
                    </div>
                  </TableCell>
                  <TableCell>{order.shipping_city || 'N/A'}</TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <div className="text-xs font-medium">
                        {order.order_items?.length || 0} item(s)
                      </div>
                      {order.order_items && order.order_items.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {order.order_items.slice(0, 2).map((item: any) => (
                            item.product_url ? (
                              <a
                                key={item.id}
                                href={item.product_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-primary hover:underline flex items-center gap-1"
                                title={item.title || 'View product'}
                              >
                                {item.product_image_url && (
                                  <img 
                                    src={item.product_image_url} 
                                    alt="" 
                                    className="h-4 w-4 object-cover rounded"
                                    onError={(e) => e.currentTarget.style.display = 'none'}
                                  />
                                )}
                                <span className="line-clamp-1">{item.title?.slice(0, 20) || 'Product'}</span>
                              </a>
                            ) : null
                          ))}
                          {order.order_items.length > 2 && (
                            <span className="text-xs text-muted-foreground">+{order.order_items.length - 2} more</span>
                          )}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="font-semibold">${Number(order.total_usd || 0).toFixed(2)}</TableCell>
                  <TableCell>{getPaymentBadge(order)}</TableCell>
                  <TableCell>{getStatusBadge(order.status)}</TableCell>
                  <TableCell>{new Date(order.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openOrderDetails(order.id)}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>

    <OrderDetailsDrawer
      orderId={selectedOrderId}
      open={drawerOpen}
      onClose={closeOrderDetails}
      onUpdate={loadOrders}
    />
    </>
  );
}
