import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CreditCard, CheckCircle2, AlertCircle, TestTube } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submissionId: string;
  amount: number;
}

export function PaymentDialog({ open, onOpenChange, submissionId, amount }: PaymentDialogProps) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [paymentComplete, setPaymentComplete] = useState(false);

  const handleMaishaPayPayment = async () => {
    setLoading(true);

    try {
      console.log('[PaymentDialog] Initiating MaishaPay payment for submission:', submissionId);

      // Call edge function to create MaishaPay payment
      const { data, error } = await supabase.functions.invoke('create-maishapay-payment', {
        body: { submissionId }
      });

      if (error) {
        console.error('[PaymentDialog] Edge function error:', error);
        throw error;
      }

      console.log('[PaymentDialog] MaishaPay payment created:', data);

      if (!data.success || !data.checkoutUrl) {
        throw new Error(data.error || 'Failed to create payment');
      }

      toast({
        title: 'Redirecting to Payment',
        description: 'You will be redirected to MaishaPay to complete payment (SANDBOX TEST).',
      });

      // Redirect to MaishaPay checkout
      setTimeout(() => {
        window.location.href = data.checkoutUrl;
      }, 1000);

    } catch (error: any) {
      console.error('[PaymentDialog] Payment error:', error);
      toast({
        title: t.common.error,
        description: error.message || 'Failed to initiate payment. Please try again.',
        variant: 'destructive',
      });
      setLoading(false);
    }
  };

  if (paymentComplete) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="glass-strong max-w-md">
          <div className="text-center py-6 space-y-4">
            <div className="flex justify-center">
              <div className="h-16 w-16 rounded-full bg-success/20 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-success animate-scale-in" />
              </div>
            </div>
            <DialogTitle className="text-2xl">Payment Confirmed!</DialogTitle>
            <DialogDescription className="text-base">
              Your submission is complete. You will be redirected to check your project status.
            </DialogDescription>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-2">
            Complete Your Payment
            <TestTube className="h-5 w-5 text-warning" />
          </DialogTitle>
          <DialogDescription className="text-base">
            Application fee: <span className="font-bold text-primary">${amount}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <Alert className="bg-warning/10 border-warning">
            <AlertCircle className="h-4 w-4 text-warning" />
            <AlertDescription className="text-sm">
              <strong>SANDBOX TEST MODE:</strong> This is a test payment. No real money will be charged.
            </AlertDescription>
          </Alert>

          <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10">
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-xl bg-primary/20 flex items-center justify-center">
                  <CreditCard className="h-8 w-8 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-lg">MaishaPay</h3>
                  <p className="text-sm text-muted-foreground">Secure Payment Gateway (Test Mode)</p>
                </div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment Method:</span>
                  <span className="font-semibold">MaishaPay</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Amount:</span>
                  <span className="font-semibold">${amount} USD</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mode:</span>
                  <span className="font-semibold text-warning">SANDBOX TEST</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-muted/50 animate-fade-in">
            <CardContent className="p-4 space-y-2 text-sm">
              <p className="font-semibold">Payment Process:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>Click "Pay with MaishaPay" below</li>
                <li>You will be redirected to MaishaPay's secure checkout</li>
                <li>Complete the test payment on their platform</li>
                <li>You will be redirected back to see your result</li>
                <li>Your project code will be generated automatically</li>
              </ol>
            </CardContent>
          </Card>

          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleMaishaPayPayment}
              disabled={loading}
              className="flex-1 shadow-glow"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Redirecting...
                </>
              ) : (
                <>
                  <CreditCard className="mr-2 h-4 w-4" />
                  Pay with MaishaPay (Test)
                </>
              )}
            </Button>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            By confirming payment, you agree to our terms and conditions
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
