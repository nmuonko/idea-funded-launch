import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, RefreshCcw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface IssueRefundDialogProps {
  order: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function IssueRefundDialog({ order, open, onOpenChange, onSuccess }: IssueRefundDialogProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [refundAmount, setRefundAmount] = useState(order?.total_usd?.toString() || '0');
  const [processing, setProcessing] = useState(false);

  const handleIssueRefund = async () => {
    if (!reason.trim()) {
      toast({
        title: 'Refund reason required',
        description: 'Please provide a reason for the refund',
        variant: 'destructive',
      });
      return;
    }

    try {
      setProcessing(true);

      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('orders')
        .update({
          refund_issued_at: new Date().toISOString(),
          refund_issued_by: user?.id,
          refund_reason: reason,
          refund_amount_usd: parseFloat(refundAmount) || order.total_usd,
          status: 'CANCELLED' as any,
          admin_notes: `REFUND ISSUED: ${reason}`,
        })
        .eq('id', order.id);

      if (error) throw error;

      // Log the action
      await supabase.from('order_actions').insert({
        order_id: order.id,
        actor_id: user?.id || '',
        action_type: 'REFUND_ISSUED',
        action_message: reason,
        metadata: { refund_amount_usd: parseFloat(refundAmount) }
      });

      toast({
        title: 'Refund Issued',
        description: `Refund of $${parseFloat(refundAmount).toFixed(2)} has been recorded`,
      });

      onSuccess();
      onOpenChange(false);
      setReason('');
    } catch (error: any) {
      console.error('Error issuing refund:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to issue refund',
        variant: 'destructive',
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCcw className="h-5 w-5" />
            Issue Refund
          </DialogTitle>
          <DialogDescription>
            Record a refund for this order. The order will be marked as cancelled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="refundAmount">Refund Amount (USD)</Label>
            <Input
              id="refundAmount"
              type="number"
              step="0.01"
              value={refundAmount}
              onChange={(e) => setRefundAmount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Original order total: ${Number(order?.total_usd || 0).toFixed(2)}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="reason">Refund Reason *</Label>
            <Textarea
              id="reason"
              placeholder="Enter reason for refund (required)..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
            />
          </div>

          <div className="bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900 rounded-lg p-3 text-sm text-yellow-800 dark:text-yellow-200">
            <p className="font-semibold mb-1">⚠️ Warning</p>
            <p>This will:</p>
            <ul className="list-disc ml-5 mt-1">
              <li>Record the refund amount and reason</li>
              <li>Mark the order as cancelled</li>
              <li>Add an entry to the order timeline</li>
            </ul>
            <p className="mt-2 text-xs">
              Note: This records the refund internally. Actual payment refund must be processed manually through your payment provider.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={processing}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleIssueRefund}
            disabled={processing || !reason.trim()}
          >
            {processing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              'Issue Refund'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
