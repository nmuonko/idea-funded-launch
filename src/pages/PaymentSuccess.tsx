import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CheckCircle, Loader2, MessageCircle, Mail } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSupportContact } from '@/hooks/useSupportContact';
import { supabase } from "@/integrations/supabase/client";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export default function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const { whatsappUrl, emailUrl } = useSupportContact();
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
        // Build query params for payment-status
        const params = new URLSearchParams();
        if (reference) params.set('reference', reference);
        if (orderId) params.set('order_id', orderId);

        // Use supabase.functions.invoke to automatically include JWT
        const { data: statusData, error: invokeError } = await supabase.functions.invoke(
          `payment-status?${params.toString()}`,
          { method: 'GET' }
        );

        if (invokeError) {
          console.error('[PaymentSuccess] Invoke error:', invokeError);
          setLoading(false);
          return;
        }

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
            <div className="flex gap-2 mt-2">
              <a href={whatsappUrl()} target="_blank" rel="noopener noreferrer" className="flex-1">
                <Button variant="outline" size="sm" className="w-full text-green-600 border-green-200 hover:bg-green-50">
                  <MessageCircle className="h-4 w-4 mr-1" /> WhatsApp
                </Button>
              </a>
              <a href={emailUrl()} target="_blank" rel="noopener noreferrer" className="flex-1">
                <Button variant="outline" size="sm" className="w-full text-blue-600 border-blue-200 hover:bg-blue-50">
                  <Mail className="h-4 w-4 mr-1" /> Email
                </Button>
              </a>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
