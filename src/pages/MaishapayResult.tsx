import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { CheckCircle, XCircle, Clock, AlertTriangle, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

/**
 * MaishaPay Result Page
 * 
 * This is the callback URL that MaishaPay redirects users to after payment.
 * URL: /maishapay/result?status=...&description=...&transactionRefId=...&operatorRefId=...
 * 
 * Status codes from MaishaPay:
 * - 202: Payment accepted/successful
 * - Other: Failed or pending
 */

type PaymentState = 'loading' | 'success' | 'pending' | 'failed' | 'error';

export default function MaishapayResult() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [state, setState] = useState<PaymentState>('loading');
  const [orderData, setOrderData] = useState<{
    orderId?: string;
    totalUsd?: number;
    totalCdf?: number;
    transactionRefId?: string;
    operatorRefId?: string;
    statusCode?: string;
    description?: string;
  }>({});

  useEffect(() => {
    const processCallback = async () => {
      // Read query params from MaishaPay redirect
      const status = searchParams.get('status');
      const description = searchParams.get('description') || 'No description provided';
      const transactionRefId = searchParams.get('transactionRefId') || searchParams.get('reference');
      const operatorRefId = searchParams.get('operatorRefId') || 'N/A';

      console.log('[MaishapayResult] Query params:', { status, description, transactionRefId, operatorRefId });

      // Store for display
      setOrderData({
        transactionRefId: transactionRefId || undefined,
        operatorRefId,
        statusCode: status || undefined,
        description,
      });

      // If no transaction ref, show error
      if (!transactionRefId) {
        setState('error');
        return;
      }

      try {
        // Call edge function to update order status
        const { data, error } = await supabase.functions.invoke('maishapay-update-order', {
          body: {
            status: status ? parseInt(status) : null,
            description,
            transactionRefId,
            operatorRefId,
          },
        });

        console.log('[MaishapayResult] Backend response:', { data, error });

        if (error) {
          console.error('[MaishapayResult] Backend error:', error);
          
          if (data?.error === 'ORDER_NOT_FOUND') {
            setState('error');
            toast({
              title: "Order not found",
              description: "We couldn't find your order. Please contact support.",
              variant: "destructive",
            });
            return;
          }

          // Still show status based on MaishaPay response even if backend update failed
          if (status === '202') {
            setState('success');
          } else {
            setState('failed');
          }
          return;
        }

        if (data?.success) {
          const paymentStatus = data.paymentStatus;
          setOrderData(prev => ({
            ...prev,
            orderId: data.orderId,
            totalUsd: data.totalUsd,
            totalCdf: data.totalCdf,
          }));

          if (paymentStatus === 'paid' || paymentStatus === 'PAID') {
            setState('success');
          } else if (paymentStatus === 'pending' || paymentStatus === 'PENDING') {
            setState('pending');
          } else {
            setState('failed');
          }
        } else {
          // Fallback to status code interpretation
          if (status === '202') {
            setState('success');
          } else {
            setState('failed');
          }
        }
      } catch (err) {
        console.error('[MaishapayResult] Processing error:', err);
        // Still try to show status based on MaishaPay response
        if (status === '202') {
          setState('success');
        } else {
          setState('failed');
        }
      }
    };

    processCallback();
  }, [searchParams, toast]);

  const renderContent = () => {
    switch (state) {
      case 'loading':
        return (
          <>
            <Loader2 className="h-16 w-16 text-primary animate-spin mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2">Verifying Payment</h1>
            <p className="text-muted-foreground mb-6">
              Please wait while we confirm your payment...
            </p>
          </>
        );

      case 'success':
        return (
          <>
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2 text-green-600">Payment Successful!</h1>
            <p className="text-muted-foreground mb-6">
              {orderData.description || 'Your payment has been confirmed.'}
            </p>
            {(orderData.totalUsd || orderData.totalCdf) && (
              <div className="bg-muted p-4 rounded-lg mb-6 text-left">
                <p className="text-sm font-semibold mb-2">Order Summary</p>
                {orderData.totalUsd && (
                  <p className="text-sm">Amount (USD): ${orderData.totalUsd.toFixed(2)}</p>
                )}
                {orderData.totalCdf && (
                  <p className="text-sm">Amount (CDF): {orderData.totalCdf.toLocaleString()} FC</p>
                )}
              </div>
            )}
            <div className="bg-muted p-4 rounded-lg mb-6 text-left text-xs space-y-1">
              {orderData.transactionRefId && (
                <p><span className="font-semibold">Transaction Reference:</span> {orderData.transactionRefId}</p>
              )}
              {orderData.operatorRefId && orderData.operatorRefId !== 'N/A' && (
                <p><span className="font-semibold">Operator Reference:</span> {orderData.operatorRefId}</p>
              )}
              {orderData.statusCode && (
                <p><span className="font-semibold">Status Code:</span> {orderData.statusCode}</p>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={() => navigate('/orders')} className="flex-1">
                View My Orders
              </Button>
              <Button onClick={() => navigate('/')} variant="outline" className="flex-1">
                Back to Home
              </Button>
            </div>
          </>
        );

      case 'pending':
        return (
          <>
            <Clock className="h-16 w-16 text-orange-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2 text-orange-600">Payment Pending</h1>
            <p className="text-muted-foreground mb-6">
              {orderData.description || 'Your payment is being processed. This may take a few moments.'}
            </p>
            <div className="bg-muted p-4 rounded-lg mb-6 text-left text-xs space-y-1">
              {orderData.transactionRefId && (
                <p><span className="font-semibold">Transaction Reference:</span> {orderData.transactionRefId}</p>
              )}
              {orderData.operatorRefId && orderData.operatorRefId !== 'N/A' && (
                <p><span className="font-semibold">Operator Reference:</span> {orderData.operatorRefId}</p>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={() => navigate('/orders')} className="flex-1">
                Check Order Status
              </Button>
              <Button onClick={() => navigate('/')} variant="outline" className="flex-1">
                Back to Home
              </Button>
            </div>
          </>
        );

      case 'failed':
        return (
          <>
            <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2 text-destructive">Payment Failed</h1>
            <p className="text-muted-foreground mb-6">
              {orderData.description || 'Your payment could not be processed or was cancelled.'}
            </p>
            <div className="bg-muted p-4 rounded-lg mb-6 text-left text-xs space-y-1">
              {orderData.transactionRefId && (
                <p><span className="font-semibold">Transaction Reference:</span> {orderData.transactionRefId}</p>
              )}
              {orderData.statusCode && (
                <p><span className="font-semibold">Status Code:</span> {orderData.statusCode}</p>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={() => navigate('/orders')} className="flex-1">
                View My Orders
              </Button>
              <Button onClick={() => navigate('/')} variant="outline" className="flex-1">
                Back to Home
              </Button>
            </div>
          </>
        );

      case 'error':
        return (
          <>
            <AlertTriangle className="h-16 w-16 text-destructive mx-auto mb-4" />
            <h1 className="text-2xl font-bold mb-2 text-destructive">Unable to Verify Payment</h1>
            <p className="text-muted-foreground mb-6">
              We could not identify your order. If you believe you were charged, please contact support with your transaction reference.
            </p>
            <div className="bg-muted p-4 rounded-lg mb-6 text-left text-xs space-y-1">
              {orderData.transactionRefId && (
                <p><span className="font-semibold">Transaction Reference:</span> {orderData.transactionRefId}</p>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button onClick={() => navigate('/support')} className="flex-1">
                Contact Support
              </Button>
              <Button onClick={() => navigate('/')} variant="outline" className="flex-1">
                Back to Home
              </Button>
            </div>
          </>
        );
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 text-center">
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
}
