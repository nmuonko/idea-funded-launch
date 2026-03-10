import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, CheckCircle, XCircle, Smartphone, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";

type PaymentStatus = "pending" | "succeeded" | "failed" | "timeout";

const translations = {
  en: {
    confirmingPayment: "Confirming Payment",
    paymentSuccessful: "Payment Successful!",
    paymentFailed: "Payment Failed",
    paymentPending: "Payment Pending",
    confirmOnPhone: "Please confirm the payment on your phone.",
    checkingStatus: "Checking status...",
    paymentConfirmed: "Your payment has been confirmed.",
    confirmationCode: "Confirmation Code",
    viewMyOrders: "View My Orders",
    tryAgain: "Try Again",
    viewOrders: "View Orders",
    paymentProcessing: "Payment is still being processed. Please check your orders page for the latest status.",
    checkOrderStatus: "Check Order Status",
    reference: "Reference",
    invalidParams: "Invalid payment callback parameters",
    paymentNotCompleted: "Payment was not completed",
    connectionError: "Connection error. Please try again.",
    retry: "Retry",
  },
  fr: {
    confirmingPayment: "Confirmation du paiement",
    paymentSuccessful: "Paiement réussi !",
    paymentFailed: "Échec du paiement",
    paymentPending: "Paiement en attente",
    confirmOnPhone: "Veuillez confirmer le paiement sur votre téléphone.",
    checkingStatus: "Vérification du statut...",
    paymentConfirmed: "Votre paiement a été confirmé.",
    confirmationCode: "Code de confirmation",
    viewMyOrders: "Voir mes commandes",
    tryAgain: "Réessayer",
    viewOrders: "Voir les commandes",
    paymentProcessing: "Le paiement est toujours en cours de traitement. Veuillez vérifier la page de vos commandes pour le dernier statut.",
    checkOrderStatus: "Vérifier le statut",
    reference: "Référence",
    invalidParams: "Paramètres de rappel de paiement invalides",
    paymentNotCompleted: "Le paiement n'a pas été effectué",
    connectionError: "Erreur de connexion. Veuillez réessayer.",
    retry: "Réessayer",
  },
};

export default function PaymentCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { language } = useLanguage();
  
  const t = translations[language as keyof typeof translations] || translations.en;
  
  const orderId = searchParams.get("orderId") || searchParams.get("order_id");
  const provider = searchParams.get("provider");
  const depositId = searchParams.get("depositId") || searchParams.get("deposit_id");
  const reference = searchParams.get("reference");
  const sessionId = searchParams.get("session_id");
  const transactionId = searchParams.get("transaction_id");
  const paymentIntent = searchParams.get("payment_intent");

  // Determine effective order identifier and provider
  const effectiveOrderId = orderId || null;
  const effectiveProvider = provider || (sessionId ? 'stripe' : (depositId ? 'pawapay' : null));
  // Any valid identifier means we should try to verify
  const hasValidParams = !!(effectiveOrderId || sessionId || depositId || transactionId || paymentIntent || reference);

  const [status, setStatus] = useState<PaymentStatus>("pending");
  const [confirmationCode, setConfirmationCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [networkError, setNetworkError] = useState(false);
  
  // Use refs to avoid pollCount triggering re-renders
  const pollCountRef = useRef(0);
  const [displayPollCount, setDisplayPollCount] = useState(0);

  const MAX_POLLS = 60; // 5 minutes at 5s intervals
  const POLL_INTERVAL = 5000;

  const pollStatus = useCallback(async (abortSignal: AbortSignal): Promise<boolean> => {
    if (abortSignal.aborted) return false;

    try {
      setNetworkError(false);
      
      const { data, error: fnError } = await supabase.functions.invoke("payments-core", {
        body: { 
          action: 'verify',
          orderId: effectiveOrderId, 
          depositId, 
          sessionId, 
          transactionId, 
          paymentIntent,
          reference,
        },
      });

      if (abortSignal.aborted) return false;

      if (fnError) {
        console.error("Verify payment error:", fnError);
        pollCountRef.current += 1;
        setDisplayPollCount(pollCountRef.current);
        return pollCountRef.current < MAX_POLLS;
      }

      const paymentStatus = data?.status || data?.payment_status;
      
      if (paymentStatus === "paid" || paymentStatus === "succeeded" || paymentStatus === "PAID" || paymentStatus === "success") {
        // Redirect to the proper shop success page which clears cart and shows order details
        const redirectOrderId = effectiveOrderId || data?.order_id;
        if (redirectOrderId) {
          window.location.href = `/payment-success-shop?order_id=${redirectOrderId}&provider=${effectiveProvider || 'unknown'}`;
        } else {
          window.location.href = `/payment-success-shop?provider=${effectiveProvider || 'unknown'}`;
        }
        return false;
      }

      if (paymentStatus === "failed" || paymentStatus === "FAILED" || paymentStatus === "cancelled" || paymentStatus === "expired") {
        setStatus("failed");
        setError(data?.error || t.paymentNotCompleted);
        return false;
      }

      pollCountRef.current += 1;
      setDisplayPollCount(pollCountRef.current);
      
      if (pollCountRef.current >= MAX_POLLS) {
        setStatus("timeout");
        return false;
      }
      
      return true;
    } catch (err) {
      console.error("Poll error:", err);
      setNetworkError(true);
      return false;
    }
  }, [effectiveOrderId, depositId, sessionId, transactionId, paymentIntent, reference, t.paymentNotCompleted]);

  useEffect(() => {
    if (!hasValidParams) {
      setError(t.invalidParams);
      setStatus("failed");
      return;
    }

    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout>;
    
    const startPolling = async () => {
      // Initial delay
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      if (abortController.signal.aborted) return;
      
      const poll = async () => {
        const shouldContinue = await pollStatus(abortController.signal);
        if (shouldContinue && !abortController.signal.aborted) {
          timeoutId = setTimeout(poll, POLL_INTERVAL);
        }
      };
      
      poll();
    };

    startPolling();

    return () => {
      abortController.abort();
      clearTimeout(timeoutId);
    };
  }, [orderId, provider, t.invalidParams, pollStatus]);

  const handleGoToOrders = () => {
    navigate("/my-orders");
  };

  const handleRetry = () => {
    navigate(`/orders/${orderId}`);
  };

  const handleRetryPolling = () => {
    setNetworkError(false);
    pollCountRef.current = 0;
    setDisplayPollCount(0);
    setStatus("pending");
    
    // Restart polling
    const abortController = new AbortController();
    const poll = async () => {
      const shouldContinue = await pollStatus(abortController.signal);
      if (shouldContinue && !abortController.signal.aborted) {
        setTimeout(poll, POLL_INTERVAL);
      }
    };
    poll();
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>
            {status === "pending" && t.confirmingPayment}
            {status === "succeeded" && t.paymentSuccessful}
            {status === "failed" && t.paymentFailed}
            {status === "timeout" && t.paymentPending}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {status === "pending" && !networkError && (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <div className="relative">
                  <Smartphone className="h-16 w-16 text-primary" />
                  <Loader2 className="h-6 w-6 animate-spin text-primary absolute -top-1 -right-1" />
                </div>
              </div>
              <p className="text-muted-foreground">
                {t.confirmOnPhone}
              </p>
              <p className="text-sm text-muted-foreground">
                {t.checkingStatus} ({displayPollCount}/{MAX_POLLS})
              </p>
            </div>
          )}

          {networkError && (
            <div className="text-center space-y-4">
              <XCircle className="h-16 w-16 text-orange-500 mx-auto" />
              <p className="text-muted-foreground">
                {t.connectionError}
              </p>
              <Button onClick={handleRetryPolling} className="w-full">
                <RefreshCw className="h-4 w-4 mr-2" />
                {t.retry}
              </Button>
            </div>
          )}

          {status === "succeeded" && (
            <div className="text-center space-y-4">
              <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
              <p className="text-muted-foreground">
                {t.paymentConfirmed}
              </p>
              {confirmationCode && (
                <div className="bg-muted p-4 rounded-lg">
                  <p className="text-sm text-muted-foreground">{t.confirmationCode}</p>
                  <p className="text-2xl font-mono font-bold">{confirmationCode}</p>
                </div>
              )}
              <Button onClick={handleGoToOrders} className="w-full">
                {t.viewMyOrders}
              </Button>
            </div>
          )}

          {status === "failed" && (
            <div className="text-center space-y-4">
              <XCircle className="h-16 w-16 text-destructive mx-auto" />
              <p className="text-muted-foreground">
                {error || t.paymentNotCompleted}
              </p>
              <div className="space-y-2">
                <Button onClick={handleRetry} className="w-full">
                  {t.tryAgain}
                </Button>
                <Button variant="outline" onClick={handleGoToOrders} className="w-full">
                  {t.viewOrders}
                </Button>
              </div>
            </div>
          )}

          {status === "timeout" && (
            <div className="text-center space-y-4">
              <Loader2 className="h-16 w-16 text-muted-foreground mx-auto" />
              <p className="text-muted-foreground">
                {t.paymentProcessing}
              </p>
              <Button onClick={handleGoToOrders} className="w-full">
                {t.checkOrderStatus}
              </Button>
            </div>
          )}

          {reference && (
            <p className="text-xs text-center text-muted-foreground">
              {t.reference}: {reference}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
