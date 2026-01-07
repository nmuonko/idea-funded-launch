import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle, XCircle, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PaymentStatus = "pending" | "succeeded" | "failed" | "timeout";

export default function PaymentCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const orderId = searchParams.get("orderId");
  const provider = searchParams.get("provider");
  const depositId = searchParams.get("depositId");
  const reference = searchParams.get("reference");

  const [status, setStatus] = useState<PaymentStatus>("pending");
  const [confirmationCode, setConfirmationCode] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const MAX_POLLS = 60; // 5 minutes at 5s intervals
  const POLL_INTERVAL = 5000;

  useEffect(() => {
    if (!orderId || provider !== "pawapay") {
      setError("Invalid payment callback parameters");
      setStatus("failed");
      return;
    }

    let timeoutId: NodeJS.Timeout;
    let isMounted = true;

    const pollStatus = async () => {
      if (!isMounted) return;

      try {
        const { data, error: fnError } = await supabase.functions.invoke("mobile-verify-payment", {
          body: { orderId, depositId },
        });

        if (!isMounted) return;

        if (fnError) {
          console.error("Verify payment error:", fnError);
          // Don't fail immediately, keep polling
          setPollCount((c) => c + 1);
          return;
        }

        const paymentStatus = data?.status || data?.payment_status;
        
        if (paymentStatus === "succeeded" || paymentStatus === "PAID") {
          setStatus("succeeded");
          setConfirmationCode(data?.confirmation_code || reference);
          return;
        }

        if (paymentStatus === "failed" || paymentStatus === "FAILED") {
          setStatus("failed");
          setError(data?.error || "Payment was not completed");
          return;
        }

        // Still pending, continue polling
        setPollCount((c) => {
          const newCount = c + 1;
          if (newCount >= MAX_POLLS) {
            setStatus("timeout");
            return newCount;
          }
          timeoutId = setTimeout(pollStatus, POLL_INTERVAL);
          return newCount;
        });
      } catch (err) {
        console.error("Poll error:", err);
        setPollCount((c) => c + 1);
        if (pollCount < MAX_POLLS) {
          timeoutId = setTimeout(pollStatus, POLL_INTERVAL);
        }
      }
    };

    // Start polling after a short delay
    timeoutId = setTimeout(pollStatus, 2000);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [orderId, provider, depositId, reference, pollCount]);

  const handleGoToOrders = () => {
    navigate("/orders");
  };

  const handleRetry = () => {
    navigate(`/orders/${orderId}`);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>
            {status === "pending" && "Confirming Payment"}
            {status === "succeeded" && "Payment Successful!"}
            {status === "failed" && "Payment Failed"}
            {status === "timeout" && "Payment Pending"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {status === "pending" && (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <div className="relative">
                  <Smartphone className="h-16 w-16 text-primary" />
                  <Loader2 className="h-6 w-6 animate-spin text-primary absolute -top-1 -right-1" />
                </div>
              </div>
              <p className="text-muted-foreground">
                Please confirm the payment on your phone.
              </p>
              <p className="text-sm text-muted-foreground">
                Checking status... ({pollCount}/{MAX_POLLS})
              </p>
            </div>
          )}

          {status === "succeeded" && (
            <div className="text-center space-y-4">
              <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
              <p className="text-muted-foreground">
                Your payment has been confirmed.
              </p>
              {confirmationCode && (
                <div className="bg-muted p-4 rounded-lg">
                  <p className="text-sm text-muted-foreground">Confirmation Code</p>
                  <p className="text-2xl font-mono font-bold">{confirmationCode}</p>
                </div>
              )}
              <Button onClick={handleGoToOrders} className="w-full">
                View My Orders
              </Button>
            </div>
          )}

          {status === "failed" && (
            <div className="text-center space-y-4">
              <XCircle className="h-16 w-16 text-destructive mx-auto" />
              <p className="text-muted-foreground">
                {error || "The payment could not be completed."}
              </p>
              <div className="space-y-2">
                <Button onClick={handleRetry} className="w-full">
                  Try Again
                </Button>
                <Button variant="outline" onClick={handleGoToOrders} className="w-full">
                  View Orders
                </Button>
              </div>
            </div>
          )}

          {status === "timeout" && (
            <div className="text-center space-y-4">
              <Loader2 className="h-16 w-16 text-muted-foreground mx-auto" />
              <p className="text-muted-foreground">
                Payment is still being processed. Please check your orders page for the latest status.
              </p>
              <Button onClick={handleGoToOrders} className="w-full">
                Check Order Status
              </Button>
            </div>
          )}

          {reference && (
            <p className="text-xs text-center text-muted-foreground">
              Reference: {reference}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
