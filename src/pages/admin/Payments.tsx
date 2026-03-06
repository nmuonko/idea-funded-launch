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
import { Loader2, Search, RefreshCw, CreditCard, CheckCircle, XCircle, Clock, ExternalLink, Eye, Copy, Trash2, Settings2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { ResetSectionDialog } from '@/components/admin/ResetSectionDialog';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';

interface Payment {
  id: string;
  order_id: string;
  provider: string;
  amount: number;
  currency: string;
  status: string;
  provider_ref: string | null;
  last_error: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  orders?: {
    id: string;
    total_usd: number;
    total_cdf?: number;
    status: string;
    created_at: string;
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
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const { permissions } = useAdminPermissions();
  const { language } = useLanguage();
  const t = getAdminTranslation(language);
  const [activeTab, setActiveTab] = useState(() => {
    const tabParam = searchParams.get('tab');
    return tabParam && ['all', 'paid', 'pending', 'failed'].includes(tabParam) ? tabParam : 'all';
  });
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  useEffect(() => {
    loadPayments();
  }, [activeTab]);

  const loadPayments = async () => {
    try {
      setLoading(true);
      
      let query = supabase
        .from('payment_attempts')
        .select(`
          *,
          orders(
            id,
            total_usd,
            total_cdf,
            status,
            created_at,
            user_id
          )
        `)
        .order('created_at', { ascending: false });

      if (activeTab === 'paid') {
        query = query.eq('status', 'paid');
      } else if (activeTab === 'pending') {
        query = query.eq('status', 'pending');
      } else if (activeTab === 'failed') {
        query = query.in('status', ['failed', 'cancelled', 'expired']);
      }

      const { data, error } = await query;
      if (error) throw error;
      
      // Fetch user profiles separately
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

  const reconcileAllPending = async () => {
    try {
      setReconciling(true);
      const { data, error } = await supabase.functions.invoke('payments-core', { body: { action: 'reconcile' } });
      if (error) throw error;
      toast({
        title: 'Reconciliation Complete',
        description: `Reconciled ${data.reconciled || 0} of ${data.totalPending || 0} pending payments`,
      });
      await loadPayments();
    } catch (error: any) {
      console.error('Error reconciling payments:', error);
      toast({
        title: 'Reconciliation Failed',
        description: error.message || 'Could not reconcile payments',
        variant: 'destructive',
      });
    } finally {
      setReconciling(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    toast({ title: 'Copied', description: `${label} copied to clipboard` });
  };

  const getPaymentStatusBadge = (status: string) => {
    if (status === 'paid') return <Badge className="bg-emerald-600"><CheckCircle className="h-3 w-3 mr-1" /> {t.payments.paid}</Badge>;
    if (status === 'failed') return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" /> {t.payments.failed}</Badge>;
    if (status === 'cancelled' || status === 'expired') return <Badge variant="secondary"><XCircle className="h-3 w-3 mr-1" /> {status}</Badge>;
    return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" /> {t.payments.pending}</Badge>;
  };

  const getProviderBadge = (provider: string) => {
    if (provider === 'stripe') return <Badge variant="outline" className="text-purple-600 border-purple-600">Stripe</Badge>;
    if (provider === 'pawapay') return <Badge variant="outline" className="text-blue-600 border-blue-600">PawaPay</Badge>;
    return <Badge variant="outline">{provider}</Badge>;
  };

  const filteredPayments = payments.filter((payment) => {
    const search = searchTerm.toLowerCase();
    return (
      payment.provider_ref?.toLowerCase().includes(search) ||
      payment.provider?.toLowerCase().includes(search) ||
      payment.orders?.profiles?.name?.toLowerCase().includes(search) ||
      payment.orders?.profiles?.full_name?.toLowerCase().includes(search) ||
      payment.order_id?.toLowerCase().includes(search)
    );
  });

  const stats = {
    total: payments.length,
    paid: payments.filter(p => p.status === 'paid').length,
    pending: payments.filter(p => p.status === 'pending').length,
    failed: payments.filter(p => ['failed', 'cancelled', 'expired'].includes(p.status)).length,
    totalAmount: payments.filter(p => p.status === 'paid').reduce((sum, p) => sum + Number(p.amount || 0), 0),
  };

  const openDetails = (payment: Payment) => {
    setSelectedPayment(payment);
    setDetailsOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t.sidebar.payments}</h1>
          <p className="text-muted-foreground">{t.payments.subtitle}</p>
        </div>
        {permissions?.isSuperAdmin && (
          <Button variant="destructive" size="sm" onClick={() => setResetDialogOpen(true)}>
            <Trash2 className="h-4 w-4 mr-2" />
            Reset Payments
          </Button>
        )}
      </div>

      <ResetSectionDialog section="payments" sectionLabel="Payments" open={resetDialogOpen} onClose={() => setResetDialogOpen(false)} onSuccess={loadPayments} />

      <div className="grid gap-4 md:grid-cols-5">
        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Total</CardTitle><CreditCard className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">{stats.total}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Paid</CardTitle><CheckCircle className="h-4 w-4 text-emerald-600" /></CardHeader><CardContent><div className="text-2xl font-bold text-emerald-600">{stats.paid}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Pending</CardTitle><Clock className="h-4 w-4 text-yellow-600" /></CardHeader><CardContent><div className="text-2xl font-bold text-yellow-600">{stats.pending}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Failed</CardTitle><XCircle className="h-4 w-4 text-destructive" /></CardHeader><CardContent><div className="text-2xl font-bold text-destructive">{stats.failed}</div></CardContent></Card>
        <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-sm font-medium">Revenue</CardTitle><CreditCard className="h-4 w-4 text-muted-foreground" /></CardHeader><CardContent><div className="text-2xl font-bold">${stats.totalAmount.toFixed(2)}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Payment Transactions</CardTitle>
              <CardDescription>{language === 'fr' ? 'Consultez et gérez les paiements Stripe & PawaPay' : 'View and manage Stripe & PawaPay payment records'}</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button onClick={reconcileAllPending} variant="outline" size="sm" disabled={reconciling || stats.pending === 0}>
                {reconciling ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Settings2 className="h-4 w-4 mr-2" />}
                Reconcile All ({stats.pending})
              </Button>
              <Button onClick={loadPayments} variant="outline" size="sm">
                <RefreshCw className="h-4 w-4 mr-2" /> Refresh
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="flex items-center justify-between mb-4">
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="paid">Paid</TabsTrigger>
                <TabsTrigger value="pending">Pending</TabsTrigger>
                <TabsTrigger value="failed">Failed</TabsTrigger>
              </TabsList>
              <div className="relative w-72">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search by provider ref, name..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8" />
              </div>
            </div>

            <TabsContent value={activeTab} className="space-y-4">
              {loading ? (
                <div className="flex justify-center p-8"><Loader2 className="h-8 w-8 animate-spin" /></div>
              ) : filteredPayments.length === 0 ? (
                <div className="text-center p-8 text-muted-foreground">No transactions found</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Provider Ref</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPayments.map((payment) => (
                      <TableRow key={payment.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openDetails(payment)}>
                        <TableCell>
                          <div className="text-sm">{new Date(payment.created_at).toLocaleDateString()}</div>
                          <div className="text-xs text-muted-foreground">{new Date(payment.created_at).toLocaleTimeString()}</div>
                        </TableCell>
                        <TableCell>{getProviderBadge(payment.provider)}</TableCell>
                        <TableCell>
                          <div>
                            <div className="font-medium">{payment.orders?.profiles?.full_name || payment.orders?.profiles?.name || 'N/A'}</div>
                            <div className="text-xs text-muted-foreground">{payment.orders?.profiles?.email || '—'}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-semibold">${Number(payment.amount || 0).toFixed(2)}</div>
                          <div className="text-xs text-muted-foreground">{payment.currency}</div>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>{getPaymentStatusBadge(payment.status)}</TableCell>
                        <TableCell className="font-mono text-xs">
                          <div className="max-w-[150px] truncate" title={payment.provider_ref || ''}>{payment.provider_ref || '—'}</div>
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" onClick={() => openDetails(payment)}>
                            <Eye className="h-4 w-4" />
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

      {/* Payment Details Dialog */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{language === 'fr' ? 'Détails du Paiement' : 'Payment Details'}</DialogTitle>
            <DialogDescription>Full transaction information</DialogDescription>
          </DialogHeader>
          
          {selectedPayment && (
            <ScrollArea className="max-h-[70vh]">
              <div className="space-y-6 p-1">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <div className="mt-1">{getPaymentStatusBadge(selectedPayment.status)}</div>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Amount</p>
                    <p className="font-semibold">${Number(selectedPayment.amount || 0).toFixed(2)} {selectedPayment.currency}</p>
                  </div>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground mb-2">Provider</p>
                  <div className="mt-1">{getProviderBadge(selectedPayment.provider)}</div>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground mb-2">Customer</p>
                  <div className="bg-muted p-3 rounded-lg space-y-1">
                    <p className="font-medium">{selectedPayment.orders?.profiles?.full_name || selectedPayment.orders?.profiles?.name || 'N/A'}</p>
                    {selectedPayment.orders?.profiles?.email && <p className="text-sm text-muted-foreground">{selectedPayment.orders.profiles.email}</p>}
                    {selectedPayment.orders?.profiles?.phone && <p className="text-sm text-muted-foreground">{selectedPayment.orders.profiles.phone}</p>}
                  </div>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground mb-2">Order</p>
                  <a href={`/admin/orders/${selectedPayment.order_id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                    View Order <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground mb-2">Provider Details</p>
                  <div className="bg-muted p-3 rounded-lg space-y-2 text-sm">
                    {selectedPayment.provider_ref && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Provider Ref:</span>
                        <span className="font-mono">{selectedPayment.provider_ref}</span>
                      </div>
                    )}
                    {selectedPayment.last_error && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last Error:</span>
                        <span className="text-destructive">{selectedPayment.last_error}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-sm text-muted-foreground mb-2">Timestamps</p>
                  <div className="bg-muted p-3 rounded-lg space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Created:</span>
                      <span>{new Date(selectedPayment.created_at).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Updated:</span>
                      <span>{new Date(selectedPayment.updated_at).toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
