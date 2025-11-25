import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Copy, Check } from "lucide-react";
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
  const [copied, setCopied] = useState(false);

  const copyConfirmationId = () => {
    navigator.clipboard.writeText(confirmationId);
    setCopied(true);
    toast.success("Confirmation ID copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePayment = () => {
    console.log("[MAISHAPAY RESET] Payment button clicked");
    console.log("[MAISHAPAY RESET] Submission data:", {
      submissionId,
      confirmationId,
      amount,
      email: applicantEmail,
      name: applicantName,
    });
    
    toast.info("Payment system is being configured. Please wait for live keys.");
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Complete Your Payment</CardTitle>
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
            <strong>Setup in Progress:</strong> Payment system is being configured with live credentials.
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

        {/* Payment Button - Placeholder */}
        <Button
          onClick={handlePayment}
          className="w-full bg-emerald-600 hover:bg-emerald-700"
          size="lg"
        >
          Pay with MaishaPay (LIVE – setup pending)
        </Button>

        <p className="text-xs text-muted-foreground text-center">
          Payment will be processed with MaishaPay once live credentials are configured
        </p>
      </CardContent>
    </Card>
  );
};
