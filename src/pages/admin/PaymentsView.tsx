import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Search, CheckCircle, XCircle, Clock, DollarSign, TestTube, Pencil } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type PaymentStatus = 'pending' | 'paid' | 'failed' | 'all';

export default function PaymentsView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<PaymentStatus>('all');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<any>(null);
  const [newAmount, setNewAmount] = useState<string>('');

  // Fetch all submissions with payment info
  const { data: payments, isLoading } = useQuery({
    queryKey: ['admin-payments', filterStatus],
    queryFn: async () => {
      let query = supabase
        .from('user_submissions')
        .select('*')
        .order('created_at', { ascending: false });

      if (filterStatus && filterStatus !== 'all') {
        query = query.eq('payment_status', filterStatus);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Manual override mutation
  const markAsPaidMutation = useMutation({
    mutationFn: async (submissionId: string) => {
      const { error } = await supabase
        .from('user_submissions')
        .update({
          payment_status: 'paid',
        })
        .eq('id', submissionId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-payments'] });
      toast({
        title: 'Success',
        description: 'Payment marked as paid (test override)',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update payment',
        variant: 'destructive',
      });
    },
  });

  // Update payment amount mutation
  const updateAmountMutation = useMutation({
    mutationFn: async ({ submissionId, amount }: { submissionId: string; amount: number }) => {
      if (amount < 20) {
        throw new Error('Minimum payment amount is $20');
      }
      
      const { error } = await supabase
        .from('user_submissions')
        .update({ payment_amount: amount })
        .eq('id', submissionId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-payments'] });
      setEditDialogOpen(false);
      setSelectedPayment(null);
      setNewAmount('');
      toast({
        title: 'Amount Updated',
        description: 'Payment amount has been updated successfully',
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update payment amount',
        variant: 'destructive',
      });
    },
  });

  const openEditDialog = (payment: any) => {
    setSelectedPayment(payment);
    setNewAmount(payment.payment_amount?.toString() || '20');
    setEditDialogOpen(true);
  };

  const handleUpdateAmount = () => {
    if (!selectedPayment) return;
    
    const amount = parseFloat(newAmount);
    if (isNaN(amount) || amount < 20) {
      toast({
        title: 'Invalid Amount',
        description: 'Please enter a valid amount (minimum $20)',
        variant: 'destructive',
      });
      return;
    }

    updateAmountMutation.mutate({
      submissionId: selectedPayment.id,
      amount,
    });
  };

  const filteredPayments = payments?.filter(
    (payment) =>
      payment.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.project_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      payment.maishapay_reference?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return (
          <Badge className="bg-success/20 text-success hover:bg-success/30">
            <CheckCircle className="h-3 w-3 mr-1" />
            Paid
          </Badge>
        );
      case 'pending':
        return (
          <Badge className="bg-warning/20 text-warning hover:bg-warning/30">
            <Clock className="h-3 w-3 mr-1" />
            Pending
          </Badge>
        );
      case 'failed':
        return (
          <Badge className="bg-destructive/20 text-destructive hover:bg-destructive/30">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Payment Management</h1>
          <p className="text-muted-foreground">Track and manage all payments</p>
        </div>
      </div>

      <Alert className="bg-warning/10 border-warning">
        <TestTube className="h-4 w-4 text-warning" />
        <AlertDescription>
          <strong>SANDBOX TEST MODE:</strong> All payments are in test mode using MaishaPay sandbox.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Payment Filters</CardTitle>
          <CardDescription>Search and filter payments</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, project code..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Filter by Status</Label>
              <Select value={filterStatus} onValueChange={(v: any) => setFilterStatus(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payments ({filteredPayments?.length || 0})</CardTitle>
          <CardDescription>All payment transactions</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Project Code</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Transaction ID</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredPayments?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No payments found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredPayments?.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>
                        <div className="font-medium">{payment.full_name}</div>
                        <div className="text-sm text-muted-foreground">{payment.email}</div>
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-muted px-2 py-1 rounded">
                          {payment.project_code || 'N/A'}
                        </code>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <DollarSign className="h-4 w-4 text-primary" />
                          {payment.payment_provider || 'maishapay'}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-semibold">
                          ${payment.payment_amount} {payment.payment_currency || 'USD'}
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(payment.payment_status)}</TableCell>
                      <TableCell>
                        {payment.maishapay_transaction_id ? (
                          <code className="text-xs bg-muted px-2 py-1 rounded">
                            {payment.maishapay_transaction_id.substring(0, 12)}...
                          </code>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {new Date(payment.created_at).toLocaleDateString()}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEditDialog(payment)}
                            disabled={updateAmountMutation.isPending}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          {payment.payment_status !== 'paid' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => markAsPaidMutation.mutate(payment.id)}
                              disabled={markAsPaidMutation.isPending}
                            >
                              {markAsPaidMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                'Mark as Paid'
                              )}
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Amount Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Payment Amount</DialogTitle>
            <DialogDescription>
              Update the payment amount for {selectedPayment?.full_name}
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Current Amount</Label>
              <Input
                value={`$${selectedPayment?.payment_amount || 0} ${selectedPayment?.payment_currency || 'USD'}`}
                disabled
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="newAmount">New Amount (minimum $20)</Label>
              <Input
                id="newAmount"
                type="number"
                min="20"
                step="0.01"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                placeholder="Enter new amount"
              />
            </div>

            {selectedPayment && parseFloat(newAmount) >= 20 && parseFloat(newAmount) !== selectedPayment.payment_amount && (
              <Alert>
                <AlertDescription>
                  Are you sure you want to change the amount from <strong>${selectedPayment.payment_amount}</strong> to <strong>${parseFloat(newAmount).toFixed(2)}</strong>?
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditDialogOpen(false)}
              disabled={updateAmountMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleUpdateAmount}
              disabled={updateAmountMutation.isPending || parseFloat(newAmount) < 20}
            >
              {updateAmountMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </>
              ) : (
                'Update Amount'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}