import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Search, RefreshCw, CreditCard, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function AdminPayments() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('all');

  useEffect(() => {
    loadPayments();
  }, [activeTab]);

  const loadPayments = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('orders')
        .select(`
          *,
          profiles!inner(name, email, phone),
          order_items(id, title, product_url, product_image_url)
        `)
        .order('created_at', { ascending: false });

      if (activeTab === 'verified') {
        query = query.not('payment_verified_at', 'is', null);
      } else if (activeTab === 'pending') {
        query = query.is('payment_verified_at', null).neq('status', 'DRAFT');
      } else if (activeTab === 'failed') {
        query = query.eq('maisha_payment_status', 'FAILED');
      }

      const { data, error } = await query;

      if (error) throw error;
      setOrders(data || []);
    } catch (error) {
      console.error('Error loading payments:', error);
      toast({
        title: 'Error',
        description: 'Failed to load payments',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getPaymentStatusBadge = (order: any) => {
    if (order.payment_verified_at) {
      return <Badge className="bg-emerald-600"><CheckCircle className="h-3 w-3 mr-1" /> Verified</Badge>;
    }
    if (order.maisha_payment_status === 'FAILED') {
      return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Failed</Badge>;
    }
    return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" /> Pending</Badge>;
  };

  const getPaymentMethod = (order: any) => {
    if (order.maisha_transaction_id) return 'MaishaPay';
    return 'Not Specified';
  };

  const filteredOrders = orders.filter((order) => {
    const search = searchTerm.toLowerCase();
    return (
      order.id.toLowerCase().includes(search) ||
      order.profiles?.name?.toLowerCase().includes(search) ||
      order.profiles?.email?.toLowerCase().includes(search) ||
      order.maisha_transaction_id?.toLowerCase().includes(search)
    );
  });

  const stats = {
    total: orders.length,
    verified: orders.filter(o => o.payment_verified_at).length,
    pending: orders.filter(o => !o.payment_verified_at && o.status !== 'DRAFT').length,
    totalAmount: orders.reduce((sum, o) => sum + Number(o.total_usd || 0), 0),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Payments</h1>
        <p className="text-muted-foreground">Track and manage all payment transactions</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Transactions</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Verified</CardTitle>
            <CheckCircle className="h-4 w-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{stats.verified}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <Clock className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Amount</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${stats.totalAmount.toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Payment Transactions</CardTitle>
              <CardDescription>View and manage all payment records</CardDescription>
            </div>
            <Button onClick={loadPayments} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="flex items-center justify-between mb-4">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="verified">Verified</TabsTrigger>
                <TabsTrigger value="pending">Pending</TabsTrigger>
                <TabsTrigger value="failed">Failed</TabsTrigger>
              </TabsList>
              <div className="relative w-64">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search transactions..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            <TabsContent value={activeTab} className="space-y-4">
              {loading ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="text-center p-8 text-muted-foreground">
                  No transactions found
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                  <TableHead>Transaction ID</TableHead>
                      <TableHead>Order ID</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="font-mono text-xs">
                          {order.maisha_transaction_id ? (
                            order.maisha_transaction_id.slice(0, 16) + '...'
                          ) : (
                            <span className="text-muted-foreground">N/A</span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {order.id.slice(0, 8)}...
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">{order.profiles?.name || 'N/A'}</div>
                            <div className="text-xs text-muted-foreground">{order.profiles?.email}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {order.order_items && order.order_items.length > 0 ? (
                            <div className="flex flex-col gap-1">
                              {order.order_items.slice(0, 1).map((item: any) => (
                                item.product_url ? (
                                  <a
                                    key={item.id}
                                    href={item.product_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-primary hover:underline flex items-center gap-1"
                                  >
                                    {item.product_image_url && (
                                      <img 
                                        src={item.product_image_url} 
                                        alt="" 
                                        className="h-4 w-4 object-cover rounded"
                                        onError={(e) => e.currentTarget.style.display = 'none'}
                                      />
                                    )}
                                    <span className="line-clamp-1">{item.title?.slice(0, 25) || 'Product'}</span>
                                  </a>
                                ) : (
                                  <span key={item.id} className="text-xs text-muted-foreground">{item.title?.slice(0, 25) || 'N/A'}</span>
                                )
                              ))}
                              {order.order_items.length > 1 && (
                                <span className="text-xs text-muted-foreground">+{order.order_items.length - 1} more</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">No items</span>
                          )}
                        </TableCell>
                        <TableCell className="font-semibold">
                          ${Number(order.total_usd || 0).toFixed(2)}
                        </TableCell>
                        <TableCell>{getPaymentMethod(order)}</TableCell>
                        <TableCell>{getPaymentStatusBadge(order)}</TableCell>
                        <TableCell>{new Date(order.created_at).toLocaleDateString()}</TableCell>
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
