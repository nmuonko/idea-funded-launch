import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Copy, Check, Loader2 } from "lucide-react";
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copyConfirmationId = () => {
    navigator.clipboard.writeText(confirmationId);
    setCopied(true);
    toast.success("Confirmation ID copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePayment = async () => {
    console.log("[MAISHAPAY CHECKOUT] Payment button clicked");
    console.log("[MAISHAPAY CHECKOUT] Submission data:", {
      submissionId,
      confirmationId,
      amount,
      email: applicantEmail,
      name: applicantName,
    });

    setLoading(true);
    setError(null);

    try {
      // Get Supabase URL from environment
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error("Supabase configuration missing");
      }

      const edgeFunctionUrl = `${supabaseUrl}/functions/v1/maishapay-create-payment`;
      console.log("[MAISHAPAY CHECKOUT] Calling edge function:", edgeFunctionUrl);

      // Call the edge function
      const response = await fetch(edgeFunctionUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": supabaseAnonKey,
          "Authorization": `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          amount,
          confirmationId,
          email: applicantEmail,
          name: applicantName,
        }),
      });

      const data = await response.json();
      console.log("[MAISHAPAY CHECKOUT] Edge function response:", data);

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Failed to create payment");
      }

      // Extract checkout URL and fields
      const { checkoutUrl, fields } = data;

      if (!checkoutUrl || !fields) {
        throw new Error("Invalid response from payment service");
      }

      console.log("[MAISHAPAY CHECKOUT] Creating hidden form for:", checkoutUrl);
      console.log("[MAISHAPAY CHECKOUT] Form fields:", fields);

      // Create a hidden form element
      const form = document.createElement("form");
      form.method = "POST";
      form.action = checkoutUrl;
      form.style.display = "none";

      // Add all fields as hidden inputs
      Object.entries(fields).forEach(([key, value]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = String(value);
        form.appendChild(input);
      });

      // Append form to body
      document.body.appendChild(form);

      console.log("[MAISHAPAY CHECKOUT] Submitting form to MaishaPay...");
      
      // Submit the form
      form.submit();

      // Note: The page will redirect to MaishaPay, so no need to remove the form
    } catch (err: any) {
      console.error("[MAISHAPAY CHECKOUT] Error:", err);
      setError(err.message || "Failed to initiate payment");
      toast.error("Payment failed: " + (err.message || "Unknown error"));
      setLoading(false);
    }
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

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {!error && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>LIVE Mode:</strong> You will be redirected to MaishaPay to complete your payment securely.
            </AlertDescription>
          </Alert>
        )}

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
          disabled={loading}
          className="w-full bg-emerald-600 hover:bg-emerald-700"
          size="lg"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            "Pay with MaishaPay (LIVE)"
          )}
        </Button>

        <p className="text-xs text-muted-foreground text-center">
          Secure payment processing powered by MaishaPay
        </p>
      </CardContent>
    </Card>
  );
};
