import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CreditCard, Phone, Banknote, CheckCircle2 } from 'lucide-react';
import { z } from 'zod';

const phoneNumberSchema = z.string()
  .trim()
  .min(1, { message: "Phone number is required" })
  .max(20, { message: "Phone number must be less than 20 characters" })
  .regex(/^[\d\s\+\-\(\)]+$/, { message: "Phone number can only contain digits, spaces, +, -, (, )" });

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submissionId: string;
  amount: number;
}

type PaymentMethod = 'm_pesa' | 'airtel_money' | 'orange_money' | 'afrimoney';

export function PaymentDialog({ open, onOpenChange, submissionId, amount }: PaymentDialogProps) {
  const { t } = useLanguage();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('m_pesa');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [paymentComplete, setPaymentComplete] = useState(false);

  const handlePayment = async () => {
    // Validate phone number
    const validation = phoneNumberSchema.safeParse(phoneNumber);
    if (!validation.success) {
      toast({
        title: t.common.error,
        description: validation.error.errors[0].message,
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);

    try {
      // Update submission with payment method
      const { error } = await supabase
        .from('user_submissions')
        .update({
          payment_method: paymentMethod,
          payment_status: 'paid',
          payment_phone_number: validation.data,
        })
        .eq('id', submissionId);

      if (error) throw error;

      setPaymentComplete(true);
      
      toast({
        title: t.common.success,
        description: 'Payment confirmed! Your project code will be generated.',
      });

      // Close dialog after 2 seconds
      setTimeout(() => {
        onOpenChange(false);
        window.location.href = '/results';
      }, 2000);
    } catch (error: any) {
      console.error('Payment error:', error);
      toast({
        title: t.common.error,
        description: 'Payment failed. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (paymentComplete) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="glass-strong max-w-md">
          <div className="text-center py-6 space-y-4">
            <div className="flex justify-center">
              <div className="h-16 w-16 rounded-full bg-success/20 flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-success animate-scale-in" />
              </div>
            </div>
            <DialogTitle className="text-2xl">Payment Confirmed!</DialogTitle>
            <DialogDescription className="text-base">
              Your submission is complete. You will be redirected to check your project status.
            </DialogDescription>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">Complete Your Payment</DialogTitle>
          <DialogDescription className="text-base">
            Application fee: <span className="font-bold text-primary">${amount}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          <div className="space-y-4">
            <Label className="text-base font-semibold">Select Payment Provider</Label>
            <RadioGroup value={paymentMethod} onValueChange={(v: any) => setPaymentMethod(v)}>
              <Card className={`cursor-pointer transition-smooth ${paymentMethod === 'm_pesa' ? 'ring-2 ring-primary shadow-glow' : ''}`}>
                <CardContent className="flex items-center space-x-4 p-4">
                  <RadioGroupItem value="m_pesa" id="m_pesa" />
                  <Label htmlFor="m_pesa" className="flex items-center gap-3 flex-1 cursor-pointer">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Phone className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-semibold">Vodacom M-Pesa</p>
                      <p className="text-sm text-muted-foreground">Pay with M-Pesa</p>
                    </div>
                  </Label>
                </CardContent>
              </Card>

              <Card className={`cursor-pointer transition-smooth ${paymentMethod === 'airtel_money' ? 'ring-2 ring-primary shadow-glow' : ''}`}>
                <CardContent className="flex items-center space-x-4 p-4">
                  <RadioGroupItem value="airtel_money" id="airtel_money" />
                  <Label htmlFor="airtel_money" className="flex items-center gap-3 flex-1 cursor-pointer">
                    <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center">
                      <Phone className="h-5 w-5 text-destructive" />
                    </div>
                    <div>
                      <p className="font-semibold">Airtel Money</p>
                      <p className="text-sm text-muted-foreground">Pay with Airtel Money</p>
                    </div>
                  </Label>
                </CardContent>
              </Card>

              <Card className={`cursor-pointer transition-smooth ${paymentMethod === 'orange_money' ? 'ring-2 ring-primary shadow-glow' : ''}`}>
                <CardContent className="flex items-center space-x-4 p-4">
                  <RadioGroupItem value="orange_money" id="orange_money" />
                  <Label htmlFor="orange_money" className="flex items-center gap-3 flex-1 cursor-pointer">
                    <div className="h-10 w-10 rounded-lg bg-warning/10 flex items-center justify-center">
                      <Phone className="h-5 w-5 text-warning" />
                    </div>
                    <div>
                      <p className="font-semibold">Orange Money</p>
                      <p className="text-sm text-muted-foreground">Pay with Orange Money</p>
                    </div>
                  </Label>
                </CardContent>
              </Card>

              <Card className={`cursor-pointer transition-smooth ${paymentMethod === 'afrimoney' ? 'ring-2 ring-primary shadow-glow' : ''}`}>
                <CardContent className="flex items-center space-x-4 p-4">
                  <RadioGroupItem value="afrimoney" id="afrimoney" />
                  <Label htmlFor="afrimoney" className="flex items-center gap-3 flex-1 cursor-pointer">
                    <div className="h-10 w-10 rounded-lg bg-success/10 flex items-center justify-center">
                      <Phone className="h-5 w-5 text-success" />
                    </div>
                    <div>
                      <p className="font-semibold">Afrimoney</p>
                      <p className="text-sm text-muted-foreground">Pay with Afrimoney</p>
                    </div>
                  </Label>
                </CardContent>
              </Card>
            </RadioGroup>
          </div>

          <div className="space-y-2 animate-fade-in">
            <Label>Mobile Money Number</Label>
            <Input
              type="tel"
              placeholder="+243 XXX XXX XXX"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              maxLength={20}
            />
            <p className="text-sm text-muted-foreground">
              Enter your mobile money number for payment confirmation
            </p>
          </div>

          <Card className="bg-muted/50 animate-fade-in">
            <CardContent className="p-4 space-y-2 text-sm">
              <p className="font-semibold">Payment Instructions:</p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li>You will receive a payment request on your phone</li>
                <li>Enter your PIN to authorize the payment</li>
                <li>Your project code will be generated automatically</li>
              </ol>
            </CardContent>
          </Card>

          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1"
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              onClick={handlePayment}
              disabled={loading}
              className="flex-1 shadow-glow"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                'Confirm Payment'
              )}
            </Button>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            By confirming payment, you agree to our terms and conditions
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
