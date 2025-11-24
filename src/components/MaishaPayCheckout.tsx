import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CreditCard, Copy, Check, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface MaishaPayCheckoutProps {
  confirmationId: string;
  applicantEmail: string;
  applicantName: string;
  submissionId: string;
  amount?: number;
}

export const MaishaPayCheckout: React.FC<MaishaPayCheckoutProps> = ({
  confirmationId,
  applicantEmail,
  applicantName,
  submissionId,
  amount = 20,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyConfirmationId = () => {
    navigator.clipboard.writeText(confirmationId);
    setCopied(true);
    toast.success("Confirmation ID copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePayment = async () => {
    setIsSubmitting(true);
    
    try {
      console.log('[MaishaPay Checkout] Initiating payment:', {
        submissionId,
        confirmationId,
        amount,
        email: applicantEmail,
      });

      // Call backend edge function to create payment
      const { data, error } = await supabase.functions.invoke('maishapay-create-payment', {
        body: {
          submissionId,
          amount,
          confirmationId,
          email: applicantEmail,
          name: applicantName,
        },
      });

      if (error) {
        console.error('[MaishaPay Checkout] Error from edge function:', error);
        throw error;
      }

      if (!data?.redirectUrl) {
        throw new Error('No redirect URL received from payment service');
      }

      console.log('[MaishaPay Checkout] Received redirect URL, redirecting...');
      toast.info('Redirecting to MaishaPay checkout...');

      // Redirect to MaishaPay
      window.location.href = data.redirectUrl;

    } catch (error: any) {
      console.error('[MaishaPay Checkout] Payment initiation failed:', error);
      toast.error(error.message || 'Failed to initiate payment. Please try again.');
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Complete Your Payment
        </CardTitle>
        <CardDescription>
          Pay the application fee to submit your project to AfriFund
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Confirmation ID Display */}
        <div className="p-4 bg-muted rounded-lg border-2 border-border">
          <label className="text-sm font-semibold text-muted-foreground block mb-2">
            Your Confirmation ID:
          </label>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-lg font-mono font-bold">
              {confirmationId}
            </code>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={copyConfirmationId}
              className="shrink-0"
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            ⚠️ <strong>Save this ID!</strong> You'll need it to track your application status.
          </p>
        </div>

        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <strong>Important:</strong> Your project will only be submitted after successful payment. The application fee is non-refundable.
          </AlertDescription>
        </Alert>

        {/* Payment Amount */}
        <div className="flex justify-between items-center p-3 bg-primary/10 rounded-lg">
          <span className="text-sm font-medium">Application Fee:</span>
          <span className="text-2xl font-bold">${amount.toFixed(2)} USD</span>
        </div>

        {/* Applicant Info */}
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Applicant:</span>
            <span className="font-medium">{applicantName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Email:</span>
            <span className="font-medium">{applicantEmail}</span>
          </div>
        </div>

        {/* Payment Button */}
        <Button
          onClick={handlePayment}
          className="w-full"
          size="lg"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Redirecting to MaishaPay...
            </>
          ) : (
            <>
              <CreditCard className="mr-2 h-4 w-4" />
              Proceed to Payment
            </>
          )}
        </Button>

        <p className="text-xs text-muted-foreground text-center">
          You will be redirected to MaishaPay's secure checkout page
        </p>
      </CardContent>
    </Card>
  );
};
