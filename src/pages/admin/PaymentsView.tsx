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
import { Loader2, Search, CheckCircle, XCircle, Clock, DollarSign, TestTube } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';

type PaymentStatus = 'pending' | 'paid' | 'failed' | '';

export default function PaymentsView() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState<PaymentStatus>('');

  // Fetch all submissions with payment info
  const { data: payments, isLoading } = useQuery({
    queryKey: ['admin-payments', filterStatus],
    queryFn: async () => {
      let query = supabase
        .from('user_submissions')
        .select('*')
        .order('created_at', { ascending: false });

      if (filterStatus) {
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
                  <SelectItem value="">All Statuses</SelectItem>
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
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}