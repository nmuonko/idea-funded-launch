import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CreditCard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface MaishaPayPaymentProps {
  submissionId: string;
  amount?: number;
  currency?: string;
}

export const MaishaPayPayment: React.FC<MaishaPayPaymentProps> = ({
  submissionId,
  amount,
  currency = "USD",
}) => {
  const [paymentReference, setPaymentReference] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Read MaishaPay configuration from environment variables
  const gatewayMode = import.meta.env.VITE_MAISHAPAY_GATEWAY_MODE ?? "0";
  const publicApiKey = import.meta.env.VITE_MAISHAPAY_PUBLIC_KEY as string | undefined;
  const secretApiKey = import.meta.env.VITE_MAISHAPAY_SECRET_KEY as string | undefined;
  const callbackUrl = import.meta.env.VITE_MAISHAPAY_CALLBACK_URL as string | undefined;
  const entryFee = amount ?? Number(import.meta.env.VITE_MAISHAPAY_ENTRY_FEE_USD ?? "20");

  // Check if all required credentials are present
  const hasRequiredConfig = publicApiKey && secretApiKey && callbackUrl;

  useEffect(() => {
    // Generate unique payment reference
    const reference = `AFRIFUND-${submissionId.substring(0, 8)}-${Date.now()}`;
    setPaymentReference(reference);

    // Update submission with payment reference
    const updateSubmission = async () => {
      if (!submissionId) return;

      try {
        const { error } = await supabase
          .from("user_submissions")
          .update({
            maishapay_reference: reference,
            payment_status: "pending",
          })
          .eq("id", submissionId);

        if (error) {
          console.error("Error updating submission reference:", error);
        }
      } catch (err) {
        console.error("Error in updateSubmission:", err);
      }
    };

    updateSubmission();
  }, [submissionId]);

  // Log missing credentials (for debugging)
  useEffect(() => {
    if (!publicApiKey) console.error("Missing VITE_MAISHAPAY_PUBLIC_KEY");
    if (!secretApiKey) console.error("Missing VITE_MAISHAPAY_SECRET_KEY");
    if (!callbackUrl) console.error("Missing VITE_MAISHAPAY_CALLBACK_URL");
  }, [publicApiKey, secretApiKey, callbackUrl]);

  const handleSubmit = (e: React.FormEvent) => {
    if (!hasRequiredConfig) {
      e.preventDefault();
      toast.error("Payment configuration incomplete. Please contact support.");
      return;
    }

    setIsSubmitting(true);
    toast.info("Redirecting to MaishaPay...");
  };

  // Build callback URL with submission ID
  const fullCallbackUrl = callbackUrl ? `${callbackUrl}?submission_id=${submissionId}` : "";

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          AfriFund – Project Competition Payment
        </CardTitle>
        <CardDescription>
          Complete your application by paying the non-refundable entry fee
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!hasRequiredConfig && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Payment system configuration is incomplete. Please contact support.
            </AlertDescription>
          </Alert>
        )}

        {gatewayMode === "0" && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Test Mode Active:</strong> This is a sandbox payment. No real money will be charged.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <div className="flex justify-between items-center p-3 bg-muted rounded-lg">
            <span className="text-sm font-medium">Application Fee:</span>
            <span className="text-lg font-bold">
              ${entryFee.toFixed(2)} {currency}
            </span>
          </div>

          {paymentReference && (
            <div className="text-xs text-muted-foreground p-2 bg-muted/50 rounded">
              Reference: {paymentReference}
            </div>
          )}
        </div>

        <form
          action="https://marchand.maishapay.online/payment/vers1.0/merchant/checkout"
          method="POST"
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          {/* Hidden fields for MaishaPay - exact field names required */}
          <input type="hidden" name="gatewayMode" value={gatewayMode} />
          <input type="hidden" name="publicApiKey" value={publicApiKey ?? ""} />
          <input type="hidden" name="secretApiKey" value={secretApiKey ?? ""} />
          <input type="hidden" name="montant" value={entryFee.toString()} />
          <input type="hidden" name="devise" value={currency} />
          <input type="hidden" name="callbackUrl" value={fullCallbackUrl} />

          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={!hasRequiredConfig || isSubmitting}
          >
            {isSubmitting ? "Redirecting..." : "Payer avec MaishaPay (Test)"}
          </Button>
        </form>

        <p className="text-xs text-muted-foreground text-center">
          You will be redirected to MaishaPay's secure checkout page
        </p>
      </CardContent>
    </Card>
  );
};
