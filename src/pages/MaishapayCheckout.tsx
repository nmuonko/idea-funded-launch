import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Loader2, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

/**
 * MaishaPay Checkout Page
 * 
 * This page renders an auto-submitting HTML form that POSTs to MaishaPay's checkout endpoint.
 * MaishaPay requires form POST submission - not a JSON API call.
 * 
 * Flow:
 * 1. Mobile app calls /mobile-checkout to create order
 * 2. Mobile app receives redirectUrl pointing here with orderId
 * 3. This page fetches order details and MaishaPay config
 * 4. Page renders hidden form and auto-submits to MaishaPay
 * 5. User completes payment on MaishaPay
 * 6. MaishaPay redirects user to /maishapay/result with status params
 */

// MaishaPay checkout form URL (constant)
const MAISHAPAY_CHECKOUT_URL = "https://marchand.maishapay.online/payment/vers1.0/merchant/checkout";

interface MaishapayConfig {
  gatewayMode: string;
  publicApiKey: string;
  secretApiKey: string;
  callbackUrl: string;
}

export default function MaishapayCheckout() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orderData, setOrderData] = useState<{
    orderId: string;
    amount: number;
    currency: string;
    reference: string;
  } | null>(null);
  const [config, setConfig] = useState<MaishapayConfig | null>(null);

  useEffect(() => {
    const loadOrderAndConfig = async () => {
      const orderId = searchParams.get('orderId') || searchParams.get('order_id');
      
      if (!orderId) {
        setError("Missing order ID. Please try again.");
        setLoading(false);
        return;
      }

      try {
        // Fetch order data from Supabase
        const { data: order, error: orderError } = await supabase
          .from('orders')
          .select('id, total_usd, maisha_transaction_id, status')
          .eq('id', orderId)
          .single();

        if (orderError || !order) {
          console.error('[MaishapayCheckout] Order fetch error:', orderError);
          setError("Order not found. Please contact support.");
          setLoading(false);
          return;
        }

        // Validate order status
        if (order.status !== 'PENDING_PAYMENT') {
          setError(`This order cannot be paid. Status: ${order.status}`);
          setLoading(false);
          return;
        }

        // Fetch MaishaPay configuration from edge function
        const { data: configData, error: configError } = await supabase.functions.invoke('maishapay-get-config');

        if (configError || !configData?.success) {
          console.error('[MaishapayCheckout] Config fetch error:', configError || configData?.error);
          setError("Payment configuration error. Please contact support.");
          setLoading(false);
          return;
        }

        // Generate reference if not exists
        const reference = order.maisha_transaction_id || `AFRISHOP-${orderId.slice(0, 8)}-${Date.now().toString(36)}`;

        // Update order with reference if it was generated
        if (!order.maisha_transaction_id) {
          await supabase
            .from('orders')
            .update({ maisha_transaction_id: reference })
            .eq('id', orderId);
        }

        setOrderData({
          orderId: order.id,
          amount: order.total_usd || 0,
          currency: 'USD',
          reference,
        });

        setConfig({
          gatewayMode: configData.gatewayMode,
          publicApiKey: configData.publicApiKey,
          secretApiKey: configData.secretApiKey,
          callbackUrl: configData.callbackUrl,
        });

        setLoading(false);

      } catch (err) {
        console.error('[MaishapayCheckout] Error:', err);
        setError("An unexpected error occurred. Please try again.");
        setLoading(false);
      }
    };

    loadOrderAndConfig();
  }, [searchParams]);

  // Auto-submit form when data is ready
  useEffect(() => {
    if (!loading && orderData && config && !error) {
      const form = document.getElementById('maishapayCheckoutForm') as HTMLFormElement;
      if (form) {
        console.log('[MaishapayCheckout] Auto-submitting form to MaishaPay');
        // Small delay to ensure form is rendered
        setTimeout(() => form.submit(), 500);
      }
    }
  }, [loading, orderData, config, error]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2">Preparing Payment</h1>
            <p className="text-muted-foreground">
              Please wait while we redirect you to MaishaPay...
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h1 className="text-xl font-bold mb-2 text-destructive">Payment Error</h1>
            <p className="text-muted-foreground mb-6">{error}</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={() => navigate('/orders')} className="flex-1">
                View Orders
              </Button>
              <Button onClick={() => navigate('/')} variant="outline" className="flex-1">
                Back to Home
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!orderData || !config) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 text-center">
          <Loader2 className="h-12 w-12 text-primary animate-spin mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Redirecting to MaishaPay</h1>
          <p className="text-muted-foreground mb-4">
            Amount: ${orderData.amount.toFixed(2)} {orderData.currency}
          </p>
          <p className="text-sm text-muted-foreground">
            If you are not redirected automatically, click the button below.
          </p>

          {/* MaishaPay Checkout Form - exactly as per documentation */}
          <form
            id="maishapayCheckoutForm"
            action={MAISHAPAY_CHECKOUT_URL}
            method="POST"
            className="mt-4"
          >
            <input type="hidden" name="gatewayMode" value={config.gatewayMode} />
            <input type="hidden" name="publicApiKey" value={config.publicApiKey} />
            <input type="hidden" name="secretApiKey" value={config.secretApiKey} />
            <input type="hidden" name="montant" value={orderData.amount.toFixed(2)} />
            <input type="hidden" name="devise" value={orderData.currency} />
            <input type="hidden" name="callbackUrl" value={config.callbackUrl} />
            <input type="hidden" name="reference" value={orderData.reference} />
            
            <noscript>
              <Button type="submit" className="w-full">
                Pay with MaishaPay
              </Button>
            </noscript>
            
            <Button type="submit" variant="outline" className="w-full mt-4">
              Click here if not redirected
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
