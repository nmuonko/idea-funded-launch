import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { CreditCard, CheckCircle2, AlertCircle, TestTube } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submissionId: string;
  amount: number;
  currency?: string;
}

export function PaymentDialog({ open, onOpenChange, submissionId, amount, currency = 'USD' }: PaymentDialogProps) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const [paymentReference, setPaymentReference] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentComplete, setPaymentComplete] = useState(false);

  // MaishaPay Sandbox Credentials
  const MAISHAPAY_GATEWAY_MODE = "0"; // 0 = sandbox, 1 = live
  const MAISHAPAY_PUBLIC_KEY = "MP-SBPK-Z2721hl2syS9mGA0yr2UQyMMl9aH0XqL1Th1Wb/kW0N.WzUdG1cTS9LnvlcP3pVdfe$3o40h$S5Ho9Fd$ft$5J80PF0hi9lybS6OX8U.4wlnk$$kSpj8.Nrp";
  const MAISHAPAY_SECRET_KEY = "MP-SBPK-dYtr5M37IwOW.r4eMMnyt$1/47BpC.dsKGHuoP0yWOHLOy.h2yB$qHMQ027TnXy4a/K$17qcT9nDECmHz4J.XmHjHc/Fvzc3OB$ZuqD2F/lRYi5$68a.5z/$";
  // Construct callback URL using Supabase project URL
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://qvhrbcvymhjxjnshbjki.supabase.co';
  const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/maishapay-callback`;

  useEffect(() => {
    if (open) {
      // Generate unique payment reference
      const reference = `AFRIFUND-${submissionId}-${Date.now()}`;
      setPaymentReference(reference);
      
      // Update submission with reference
      updateSubmissionReference(reference);
    }
  }, [open, submissionId]);

  const updateSubmissionReference = async (reference: string) => {
    try {
      console.log('[MaishaPay] Updating submission with reference:', reference);
      
      const { error } = await supabase
        .from('user_submissions')
        .update({
          maishapay_reference: reference,
          payment_status: 'pending',
        })
        .eq('id', submissionId);

      if (error) {
        console.error('[MaishaPay] Failed to update submission reference:', error);
        throw error;
      }

      console.log('[MaishaPay] Submission updated with reference');
    } catch (error) {
      console.error('[MaishaPay] Error updating submission:', error);
      toast({
        title: t.common.error,
        description: 'Failed to prepare payment. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const handleSubmit = () => {
    if (!paymentReference) {
      toast({
        title: t.common.error,
        description: 'Payment reference not ready. Please wait a moment.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    
    toast({
      title: 'Redirecting to Payment',
      description: 'You will be redirected to MaishaPay to complete payment (SANDBOX TEST).',
    });

    // Submit form to MaishaPay
    setTimeout(() => {
      formRef.current?.submit();
    }, 500);
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
                  <span className="font-semibold">${amount} {currency}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mode:</span>
                  <span className="font-semibold text-warning">SANDBOX TEST</span>
                </div>
                {paymentReference && (
                  <div className="flex justify-between text-xs pt-2 border-t">
                    <span className="text-muted-foreground">Reference:</span>
                    <span className="font-mono">{paymentReference}</span>
                  </div>
                )}
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

          {/* Hidden form that POSTs to MaishaPay */}
          <form
            ref={formRef}
            action="https://marchand.maishapay.online/payment/vers1.0/merchant/checkout"
            method="POST"
            style={{ display: 'none' }}
          >
            <input type="hidden" name="gatewayMode" value={MAISHAPAY_GATEWAY_MODE} />
            <input type="hidden" name="publicApiKey" value={MAISHAPAY_PUBLIC_KEY} />
            <input type="hidden" name="secretApiKey" value={MAISHAPAY_SECRET_KEY} />
            <input type="hidden" name="montant" value={amount} />
            <input type="hidden" name="devise" value={currency} />
            <input type="hidden" name="callbackUrl" value={CALLBACK_URL} />
          </form>

          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !paymentReference}
              className="flex-1 shadow-glow"
            >
              <CreditCard className="mr-2 h-4 w-4" />
              Pay with MaishaPay (Test)
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
