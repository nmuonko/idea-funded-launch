import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Search, RefreshCw, CreditCard, CheckCircle, XCircle, Clock, ExternalLink, TestTube } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function AdminPayments() {
  const { toast } = useToast();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  useEffect(() => {
    loadPayments();
  }, [activeTab]);

  const loadPayments = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('maisha_payments')
        .select(`
          *,
          orders!inner(
            id,
            total_usd,
            total_cdf,
            status,
            created_at,
            maisha_payment_status,
            maisha_transaction_id,
            operator_ref_id,
            profiles!inner(name, full_name, phone)
          )
        `)
        .order('created_at', { ascending: false });

      if (activeTab === 'verified') {
        query = query.eq('status', 'paid');
      } else if (activeTab === 'pending') {
        query = query.eq('status', 'pending');
      } else if (activeTab === 'failed') {
        query = query.eq('status', 'failed');
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

  const verifyPaymentStatus = async (payment: any) => {
    try {
      setVerifyingId(payment.id);
      
      const { data, error } = await supabase.functions.invoke('verify-maisha-payment', {
        body: { 
          orderId: payment.order_id,
          reference: payment.maisha_reference,
        },
      });

      if (error) throw error;

      toast({
        title: 'Verification Complete',
        description: `Payment status: ${data.status || 'unknown'}`,
      });

      // Reload payments to get updated data
      await loadPayments();
    } catch (error: any) {
      console.error('Error verifying payment:', error);
      toast({
        title: 'Verification Failed',
        description: error.message || 'Could not verify payment status',
        variant: 'destructive',
      });
    } finally {
      setVerifyingId(null);
    }
  };

  const getPaymentStatusBadge = (status: string) => {
    if (status === 'paid') {
      return <Badge className="bg-emerald-600"><CheckCircle className="h-3 w-3 mr-1" /> Paid</Badge>;
    }
    if (status === 'failed') {
      return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> Failed</Badge>;
    }
    if (status === 'cancelled') {
      return <Badge variant="secondary"><XCircle className="h-3 w-3 mr-1" /> Cancelled</Badge>;
    }
    return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" /> Pending</Badge>;
  };

  const getModeBadge = (payment: any) => {
    // Check if it's sandbox mode based on raw_request or reference pattern
    const isSandbox = payment.raw_request?.mode === 'sandbox' || 
                      payment.maisha_reference?.includes('TEST') ||
                      !payment.raw_request?.mode;
    
    if (isSandbox) {
      return (
        <Badge variant="outline" className="text-amber-600 border-amber-600">
          <TestTube className="h-3 w-3 mr-1" />
          Sandbox
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-emerald-600 border-emerald-600">
        Live
      </Badge>
    );
  };

  const filteredOrders = orders.filter((payment) => {
    const search = searchTerm.toLowerCase();
    return (
      payment.maisha_reference?.toLowerCase().includes(search) ||
      payment.orders?.profiles?.name?.toLowerCase().includes(search) ||
      payment.orders?.profiles?.full_name?.toLowerCase().includes(search) ||
      payment.order_id?.toLowerCase().includes(search)
    );
  });

  const stats = {
    total: orders.length,
    verified: orders.filter(p => p.status === 'paid').length,
    pending: orders.filter(p => p.status === 'pending').length,
    totalAmount: orders.reduce((sum, p) => sum + Number(p.amount_usd || 0), 0),
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Payments</h1>
        <p className="text-muted-foreground">Track and manage MaishaPay transactions</p>
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
              <CardDescription>View and manage MaishaPay payment records</CardDescription>
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
                  <TabsTrigger value="verified">Paid</TabsTrigger>
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
                      <TableHead>MaishaPay Reference</TableHead>
                      <TableHead>Order ID</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Amount (USD)</TableHead>
                      <TableHead>Amount (CDF)</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders.map((payment) => (
                      <TableRow key={payment.id}>
                        <TableCell className="font-mono text-xs">
                          <div className="flex items-center gap-2">
                            {payment.maisha_reference}
                            {payment.orders?.operator_ref_id && (
                              <span className="text-muted-foreground">
                                ({payment.orders.operator_ref_id.slice(0, 8)}...)
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          <a 
                            href={`/admin/orders/${payment.order_id}`}
                            className="text-primary hover:underline flex items-center gap-1"
                          >
                            {payment.order_id?.slice(0, 8)}...
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">
                              {payment.orders?.profiles?.full_name || payment.orders?.profiles?.name || 'N/A'}
                            </div>
                            <div className="text-xs text-muted-foreground">{payment.orders?.profiles?.phone}</div>
                          </div>
                        </TableCell>
                        <TableCell className="font-semibold">
                          ${Number(payment.amount_usd || 0).toFixed(2)}
                        </TableCell>
                        <TableCell className="font-semibold">
                          {Number(payment.amount_cdf || 0).toLocaleString()} CDF
                        </TableCell>
                        <TableCell>{getPaymentStatusBadge(payment.status)}</TableCell>
                        <TableCell>{getModeBadge(payment)}</TableCell>
                        <TableCell>
                          <div className="text-sm">
                            {new Date(payment.created_at).toLocaleDateString()}
                          </div>
                          {payment.paid_at && (
                            <div className="text-xs text-muted-foreground">
                              Paid: {new Date(payment.paid_at).toLocaleTimeString()}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => verifyPaymentStatus(payment)}
                            disabled={verifyingId === payment.id || payment.status === 'paid'}
                          >
                            {verifyingId === payment.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <>
                                <RefreshCw className="h-4 w-4 mr-1" />
                                Verify
                              </>
                            )}
                          </Button>
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
