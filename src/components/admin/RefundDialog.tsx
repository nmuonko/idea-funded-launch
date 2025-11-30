import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface RefundDialogProps {
  orderId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function RefundDialog({ orderId, open, onOpenChange, onSuccess }: RefundDialogProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [processing, setProcessing] = useState(false);

  const handleRefund = async () => {
    try {
      setProcessing(true);

      const { data, error } = await supabase.functions.invoke('maisha-process-refund', {
        body: { orderId, reason },
      });

      if (error) throw error;

      toast({
        title: 'Refund Processed',
        description: data.message || 'Refund has been processed successfully',
      });

      onSuccess();
      onOpenChange(false);
      setReason('');
    } catch (error: any) {
      console.error('Error processing refund:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to process refund',
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
          <DialogTitle>Process Refund</DialogTitle>
          <DialogDescription>
            This will refund the payment and cancel the order. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="reason">Refund Reason</Label>
            <Textarea
              id="reason"
              placeholder="Enter reason for refund..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
            />
          </div>

          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
            <p className="font-semibold mb-1">⚠️ Warning</p>
            <p>This will:</p>
            <ul className="list-disc ml-5 mt-1">
              <li>Process a refund through MaishaPay</li>
              <li>Cancel the order</li>
              <li>Update payment status to "refunded"</li>
            </ul>
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
            onClick={handleRefund}
            disabled={processing || !reason.trim()}
          >
            {processing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              'Process Refund'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
