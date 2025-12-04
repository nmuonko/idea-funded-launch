import { useSearchParams, useNavigate } from "react-router-dom";
import { XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function PaymentFail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const reference = searchParams.get('reference') || searchParams.get('ref');
  const orderId = searchParams.get('order_id') || searchParams.get('orderId');
  const reason = searchParams.get('reason') || searchParams.get('description');

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-6 text-center">
          <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2 text-destructive">Payment Failed</h1>
          <p className="text-muted-foreground mb-6">
            {reason || 'Your payment could not be processed or was cancelled. Please try again.'}
          </p>

          {(reference || orderId) && (
            <div className="bg-muted p-4 rounded-lg mb-6 text-left text-xs">
              {reference && (
                <p><span className="font-semibold">Reference:</span> {reference}</p>
              )}
              {orderId && (
                <p><span className="font-semibold">Order ID:</span> {orderId}</p>
              )}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <Button onClick={() => navigate('/orders')} className="flex-1">
              View My Orders
            </Button>
            <Button onClick={() => navigate('/')} variant="outline" className="flex-1">
              Back to Home
            </Button>
          </div>

          <p className="text-xs text-muted-foreground mt-6">
            If you believe you were charged incorrectly, please contact support.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
