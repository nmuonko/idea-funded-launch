import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle2, AlertCircle, Shield, Loader2 } from 'lucide-react';

interface PaymentVerificationPanelProps {
  order: any;
  onUpdate: () => void;
}

export function PaymentVerificationPanel({ order, onUpdate }: PaymentVerificationPanelProps) {
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const { toast } = useToast();

  const verifyPayment = async () => {
    try {
      setLoading(true);

      // Manual verification - directly update order
      const { error } = await supabase
        .from('orders')
        .update({
          payment_verified_at: new Date().toISOString(),
          payment_verification_method: 'MANUAL_ADMIN_VERIFICATION',
          payment_notes: notes || 'Manually verified by admin',
          status: 'PAID'
        })
        .eq('id', order.id);

      if (error) throw error;

      toast({
        title: 'Payment verified',
        description: 'Payment has been successfully verified',
      });

      setNotes('');
      onUpdate();
    } catch (error: any) {
      toast({
        title: 'Verification failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getPaymentStatusBadge = () => {
    if (order.payment_verified_at) {
      return (
        <Badge className="bg-green-600">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Verified
        </Badge>
      );
    }

    return (
      <Badge variant="outline" className="text-yellow-600 border-yellow-600">
        <AlertCircle className="h-3 w-3 mr-1" />
        Pending
      </Badge>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Payment Verification
        </CardTitle>
        <CardDescription>
          Verify bank transfer or manual payment
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Payment Status */}
        <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
          <div>
            <p className="text-sm font-medium">Current Status</p>
          </div>
          {getPaymentStatusBadge()}
        </div>

        {/* Verification Details */}
        {order.payment_verified_at && (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Verified At:</span>
              <span>{new Date(order.payment_verified_at).toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Method:</span>
              <Badge variant="outline">
                {order.payment_verification_method || 'N/A'}
              </Badge>
            </div>
            {order.payment_notes && (
              <div>
                <p className="text-muted-foreground mb-1">Notes:</p>
                <p className="text-xs bg-muted p-2 rounded">{order.payment_notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Verification Actions */}
        {!order.payment_verified_at && (
          <>
            <Textarea
              placeholder="Add verification notes (optional)..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[60px]"
            />

            <Button
              onClick={verifyPayment}
              disabled={loading}
              className="w-full"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Shield className="h-4 w-4 mr-2" />
                  Verify Payment
                </>
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
