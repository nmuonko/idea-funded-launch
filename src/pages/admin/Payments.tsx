import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search, RefreshCw, CreditCard, CheckCircle, XCircle, Clock, ExternalLink, TestTube, Eye, Copy } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Payment {
  id: string;
  order_id: string;
  user_id?: string;
  maisha_reference: string;
  confirmation_code?: string;
  amount_usd: number;
  amount_cdf?: number;
  currency: string;
  status: string;
  maishapay_status?: string;
  maishapay_description?: string;
  maishapay_transaction_ref_id?: string;
  maishapay_operator_ref_id?: string;
  raw_query?: any;
  raw_request?: any;
  raw_response?: any;
  created_at: string;
  updated_at: string;
  paid_at?: string;
  orders?: {
    id: string;
    total_usd: number;
    total_cdf?: number;
    status: string;
    created_at: string;
    maisha_payment_status?: string;
    maisha_transaction_id?: string;
    operator_ref_id?: string;
    user_id?: string;
    profiles?: {
      name?: string;
      full_name?: string;
      email?: string;
      phone?: string;
    };
  };
}

export default function AdminPayments() {
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  // Check URL params for initial tab (e.g., ?tab=pending from dashboard)
  const [activeTab, setActiveTab] = useState(() => {
    const tabParam = searchParams.get('tab');
    return tabParam && ['all', 'verified', 'pending', 'failed'].includes(tabParam) ? tabParam : 'all';
  });
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    loadPayments();
  }, [activeTab]);

  const loadPayments = async () => {
    try {
      setLoading(true);
      
      // Use LEFT JOIN (no !inner) to avoid filtering out payments without matching profiles
      let query = supabase
        .from('maisha_payments')
        .select(`
          *,
          orders(
            id,
            total_usd,
            total_cdf,
            status,
            created_at,
            maisha_payment_status,
            maisha_transaction_id,
            operator_ref_id,
            user_id
          )
        `)
        .order('created_at', { ascending: false });

      if (activeTab === 'verified') {
        query = query.eq('status', 'paid');
      } else if (activeTab === 'pending') {
        query = query.eq('status', 'pending');
      } else if (activeTab === 'failed') {
        query = query.in('status', ['failed', 'cancelled']);
      }

      const { data, error } = await query;

      if (error) throw error;
      
      // Fetch user profiles separately for the user_ids we found
      const userIds = [...new Set(data?.map(p => p.orders?.user_id).filter(Boolean) || [])];
      let profilesMap: Record<string, any> = {};
      
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, name, full_name, email, phone')
          .in('user_id', userIds);
        
        profilesMap = (profiles || []).reduce((acc, p) => {
          acc[p.user_id] = p;
          return acc;
        }, {} as Record<string, any>);
      }
      
      // Attach profiles to payments
      const paymentsWithProfiles = (data || []).map(payment => ({
        ...payment,
        orders: payment.orders ? {
          ...payment.orders,
          profiles: profilesMap[payment.orders.user_id] || null
        } : null
      }));
      
      setPayments(paymentsWithProfiles);
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

  const verifyPaymentStatus = async (payment: Payment) => {
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

  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast({
      title: 'Copied',
      description: `${label} copied to clipboard`,
    });
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

  const getModeBadge = (payment: Payment) => {
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

  const filteredPayments = payments.filter((payment) => {
    const search = searchTerm.toLowerCase();
    return (
      payment.maisha_reference?.toLowerCase().includes(search) ||
      payment.confirmation_code?.toLowerCase().includes(search) ||
      payment.maishapay_transaction_ref_id?.toLowerCase().includes(search) ||
      payment.orders?.profiles?.name?.toLowerCase().includes(search) ||
      payment.orders?.profiles?.full_name?.toLowerCase().includes(search) ||
      payment.order_id?.toLowerCase().includes(search)
    );
  });

  const stats = {
    total: payments.length,
    verified: payments.filter(p => p.status === 'paid').length,
    pending: payments.filter(p => p.status === 'pending').length,
    failed: payments.filter(p => p.status === 'failed').length,
    totalAmount: payments.filter(p => p.status === 'paid').reduce((sum, p) => sum + Number(p.amount_usd || 0), 0),
  };

  const openDetails = (payment: Payment) => {
    setSelectedPayment(payment);
    setDetailsOpen(true);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Payments</h1>
        <p className="text-muted-foreground">Track and manage MaishaPay transactions</p>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Paid</CardTitle>
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
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
            <XCircle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats.failed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Revenue</CardTitle>
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
              <div className="relative w-72">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by confirmation code, ref..."
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
              ) : filteredPayments.length === 0 ? (
                <div className="text-center p-8 text-muted-foreground">
                  No transactions found
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Confirmation Code</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Amount (USD)</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>MaishaPay Ref</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPayments.map((payment) => (
                      <TableRow key={payment.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openDetails(payment)}>
                        <TableCell>
                          <div className="text-sm">
                            {new Date(payment.created_at).toLocaleDateString()}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(payment.created_at).toLocaleTimeString()}
                          </div>
                        </TableCell>
                        <TableCell>
                          {payment.confirmation_code ? (
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-primary">
                                {payment.confirmation_code}
                              </span>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyToClipboard(payment.confirmation_code!, 'Confirmation code');
                                }}
                              >
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">
                              {payment.orders?.profiles?.full_name || payment.orders?.profiles?.name || 'N/A'}
                            </div>
                            <div className="text-xs text-muted-foreground">{payment.orders?.profiles?.email || payment.raw_request?.email || payment.orders?.profiles?.phone || '—'}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-semibold">${Number(payment.amount_usd || 0).toFixed(2)}</div>
                          {payment.amount_cdf && (
                            <div className="text-xs text-muted-foreground">
                              {Number(payment.amount_cdf).toLocaleString()} CDF
                            </div>
                          )}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {getPaymentStatusBadge(payment.status)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          <div className="max-w-[150px] truncate" title={payment.maisha_reference}>
                            {payment.maisha_reference}
                          </div>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          {getModeBadge(payment)}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openDetails(payment)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => verifyPaymentStatus(payment)}
                              disabled={verifyingId === payment.id || payment.status === 'paid'}
                            >
                              {verifyingId === payment.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
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

      {/* Payment Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Payment Details</DialogTitle>
            <DialogDescription>
              Full transaction information
            </DialogDescription>
          </DialogHeader>
          
          {selectedPayment && (
            <ScrollArea className="max-h-[70vh]">
              <div className="space-y-6 p-1">
                {/* Confirmation Code */}
                {selectedPayment.confirmation_code && (
                  <div className="bg-primary/10 border border-primary/20 rounded-lg p-4 text-center">
                    <p className="text-sm text-muted-foreground mb-1">Confirmation Code</p>
                    <p className="text-2xl font-bold font-mono text-primary">
                      {selectedPayment.confirmation_code}
                    </p>
                  </div>
                )}

                {/* Status & Amount */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <div className="mt-1">{getPaymentStatusBadge(selectedPayment.status)}</div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Amount</p>
                    <p className="font-semibold">${Number(selectedPayment.amount_usd || 0).toFixed(2)} USD</p>
                    {selectedPayment.amount_cdf && (
                      <p className="text-sm text-muted-foreground">
                        {Number(selectedPayment.amount_cdf).toLocaleString()} CDF
                      </p>
                    )}
                  </div>
                </div>

                {/* Customer Info */}
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Customer</p>
                  <div className="bg-muted p-3 rounded-lg space-y-1">
                    <p className="font-medium">
                      {selectedPayment.orders?.profiles?.full_name || selectedPayment.orders?.profiles?.name || 'N/A'}
                    </p>
                    {selectedPayment.raw_request?.email && (
                      <p className="text-sm text-muted-foreground">{selectedPayment.raw_request.email}</p>
                    )}
                    {selectedPayment.orders?.profiles?.phone && (
                      <p className="text-sm text-muted-foreground">{selectedPayment.orders.profiles.phone}</p>
                    )}
                  </div>
                </div>

                {/* Order Link */}
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Order</p>
                  <a 
                    href={`/admin/orders/${selectedPayment.order_id}`}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    View Order <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                {/* MaishaPay Details */}
                <div>
                  <p className="text-sm text-muted-foreground mb-2">MaishaPay Details</p>
                  <div className="bg-muted p-3 rounded-lg space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Reference:</span>
                      <span className="font-mono">{selectedPayment.maisha_reference}</span>
                    </div>
                    {selectedPayment.maishapay_transaction_ref_id && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Transaction Ref:</span>
                        <span className="font-mono">{selectedPayment.maishapay_transaction_ref_id}</span>
                      </div>
                    )}
                    {selectedPayment.maishapay_operator_ref_id && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Operator Ref:</span>
                        <span className="font-mono">{selectedPayment.maishapay_operator_ref_id}</span>
                      </div>
                    )}
                    {selectedPayment.maishapay_status && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">MaishaPay Status:</span>
                        <span>{selectedPayment.maishapay_status}</span>
                      </div>
                    )}
                    {selectedPayment.maishapay_description && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Description:</span>
                        <span>{selectedPayment.maishapay_description}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Timestamps */}
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Timestamps</p>
                  <div className="bg-muted p-3 rounded-lg space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Created:</span>
                      <span>{new Date(selectedPayment.created_at).toLocaleString()}</span>
                    </div>
                    {selectedPayment.paid_at && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Paid:</span>
                        <span>{new Date(selectedPayment.paid_at).toLocaleString()}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Updated:</span>
                      <span>{new Date(selectedPayment.updated_at).toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                {/* Raw Query Data */}
                {selectedPayment.raw_query && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">Raw Callback Query</p>
                    <pre className="bg-muted p-3 rounded-lg text-xs overflow-auto max-h-32">
                      {JSON.stringify(selectedPayment.raw_query, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
