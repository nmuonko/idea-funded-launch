import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CheckCircle, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/integrations/supabase/client";

export default function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [orderData, setOrderData] = useState<{
    orderId?: string;
    totalUsd?: number;
    totalCdf?: number;
    transactionId?: string;
    paidAt?: string;
  }>({});

  useEffect(() => {
    const fetchStatus = async () => {
      const reference = searchParams.get('reference') || searchParams.get('ref');
      const orderId = searchParams.get('order_id') || searchParams.get('orderId');

      console.log('[PaymentSuccess] Params:', { reference, orderId });

      if (!reference && !orderId) {
        setLoading(false);
        return;
      }

      try {
        // Call the payment-status endpoint
        const { data, error } = await supabase.functions.invoke('payment-status', {
          body: null,
          headers: {},
        });

        // Use fetch directly since we need query params
        const supabaseUrl = SUPABASE_URL;
        const params = new URLSearchParams();
        if (reference) params.set('reference', reference);
        if (orderId) params.set('order_id', orderId);

        const response = await fetch(
          `${supabaseUrl}/functions/v1/payment-status?${params.toString()}`,
          {
            headers: {
              'apikey': SUPABASE_ANON_KEY,
            },
          }
        );

        const statusData = await response.json();
        console.log('[PaymentSuccess] Status data:', statusData);

        if (statusData.success) {
          setOrderData({
            orderId: statusData.orderId,
            totalUsd: statusData.totalUsd,
            totalCdf: statusData.totalCdf,
            transactionId: statusData.transactionId,
            paidAt: statusData.paidAt,
          });
        }
      } catch (err) {
        console.error('[PaymentSuccess] Error fetching status:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
  }, [searchParams]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <Loader2 className="h-16 w-16 text-primary animate-spin mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Verifying Payment</h1>
            <p className="text-muted-foreground">Please wait...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 text-center">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2 text-green-600">Payment Successful!</h1>
          <p className="text-muted-foreground mb-6">
            Your payment has been confirmed. Thank you for your order!
          </p>
          
          {(orderData.totalUsd || orderData.totalCdf) && (
            <div className="bg-muted p-4 rounded-lg mb-6 text-left">
              <p className="text-sm font-semibold mb-2">Order Summary</p>
              {orderData.orderId && (
                <p className="text-sm">Order ID: {orderData.orderId.substring(0, 8)}...</p>
              )}
              {orderData.totalUsd && (
                <p className="text-sm">Amount (USD): ${orderData.totalUsd.toFixed(2)}</p>
              )}
              {orderData.totalCdf && (
                <p className="text-sm">Amount (CDF): {orderData.totalCdf.toLocaleString()} FC</p>
              )}
              {orderData.transactionId && (
                <p className="text-sm text-xs mt-2 text-muted-foreground">
                  Transaction: {orderData.transactionId}
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Your order is being processed. You can safely close this window and return to the app.
            </p>
            <Button 
              onClick={() => window.close()}
              variant="outline" 
              className="w-full"
            >
              Close Window
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
