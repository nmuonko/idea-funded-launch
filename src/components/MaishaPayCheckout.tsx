import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CreditCard, Copy, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface MaishaPayCheckoutProps {
  confirmationId: string;
  applicantEmail: string;
  applicantName?: string;
}

export const MaishaPayCheckout: React.FC<MaishaPayCheckoutProps> = ({
  confirmationId,
  applicantEmail,
  applicantName,
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

  // Read environment variables - using exact names as specified
  const mode = (import.meta.env.VITE_MAISHAPAY_MODE ?? "sandbox").toLowerCase();
  const sandboxPublic  = import.meta.env.VITE_MAISHAPAY_SANDBOX_PUBLIC_KEY as string | undefined;
  const sandboxSecret  = import.meta.env.VITE_MAISHAPAY_SANDBOX_SECRET_KEY as string | undefined;
  const livePublic     = import.meta.env.VITE_MAISHAPAY_LIVE_PUBLIC_KEY as string | undefined;
  const liveSecret     = import.meta.env.VITE_MAISHAPAY_LIVE_SECRET_KEY as string | undefined;
  const callbackUrl    = import.meta.env.VITE_MAISHAPAY_CALLBACK_URL as string | undefined;
  const entryFeeStr    = import.meta.env.VITE_MAISHAPAY_ENTRY_FEE_USD ?? "20";

  // DEBUG: Log all env vars to see which are undefined
  console.log("MAISHAPAY ENV DEBUG", {
    mode: import.meta.env.VITE_MAISHAPAY_MODE,
    sandboxPublic: import.meta.env.VITE_MAISHAPAY_SANDBOX_PUBLIC_KEY,
    sandboxSecret: import.meta.env.VITE_MAISHAPAY_SANDBOX_SECRET_KEY,
    livePublic: import.meta.env.VITE_MAISHAPAY_LIVE_PUBLIC_KEY,
    liveSecret: import.meta.env.VITE_MAISHAPAY_LIVE_SECRET_KEY,
    callbackUrl: import.meta.env.VITE_MAISHAPAY_CALLBACK_URL,
    entryFee: import.meta.env.VITE_MAISHAPAY_ENTRY_FEE_USD,
  });

  const isLive = mode === 'live';
  const gatewayMode = isLive ? 1 : 0;

  const publicApiKey = isLive ? livePublic : sandboxPublic;
  const secretApiKey = isLive ? liveSecret : sandboxSecret;

  const entryFee = Number(entryFeeStr);

  // Validation - exactly as requested
  const missingConfig =
    !publicApiKey ||
    !secretApiKey ||
    !callbackUrl ||
    !Number.isFinite(entryFee);

  const hasValidConfig = !missingConfig;

  const handleSubmit = (e: React.FormEvent) => {
    if (!hasValidConfig) {
      e.preventDefault();
      toast.error('Payment configuration incomplete. Please contact support.');
      return;
    }

    setIsSubmitting(true);
    toast.info('Redirecting to MaishaPay secure checkout...');
  };

  const copyConfirmationId = () => {
    navigator.clipboard.writeText(confirmationId);
    setCopied(true);
    toast.success('Confirmation ID copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  const checkoutUrl = 'https://marchand.maishapay.online/payment/vers1.0/merchant/checkout';

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="h-6 w-6 text-primary" />
            <div>
              <CardTitle>AfriFund – Project Competition Payment</CardTitle>
              <CardDescription>Complete your application by paying the non-refundable entry fee</CardDescription>
            </div>
          </div>
          <Badge variant={isLive ? 'default' : 'secondary'} className={isLive ? 'bg-emerald-500' : 'bg-yellow-500'}>
            {isLive ? '🔒 LIVE MODE' : '🧪 SANDBOX TEST'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Configuration Warning */}
        {!hasValidConfig && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="font-semibold">
              Payment system configuration is incomplete. Please contact support at info@afri-fund.org
            </AlertDescription>
          </Alert>
        )}

        {/* Mode Info Alert */}
        {!isLive && hasValidConfig && (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>Test Mode Active:</strong> This is a sandbox payment. No real money will be charged.
            </AlertDescription>
          </Alert>
        )}

        {/* Application Fee Display */}
        <div className="p-4 bg-muted/50 rounded-lg border-2 border-primary/20">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium text-muted-foreground">Application Fee:</span>
            <span className="text-3xl font-bold text-primary">${entryFee.toFixed(2)} USD</span>
          </div>
        </div>

        {/* Confirmation ID Section */}
        <div className="space-y-2">
          <label className="text-sm font-semibold">Your Confirmation ID:</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 p-3 bg-emerald-50 dark:bg-emerald-950 rounded-lg border-2 border-emerald-200 dark:border-emerald-800">
              <code className="text-lg font-mono font-bold text-emerald-700 dark:text-emerald-300">
                {confirmationId}
              </code>
            </div>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={copyConfirmationId}
              className="shrink-0"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            ⚠️ <strong>Keep this ID safe!</strong> You will use it to track your competition status on the Results page.
          </p>
        </div>

        {/* Checkout Form */}
        <form action={checkoutUrl} method="POST" onSubmit={handleSubmit} className="space-y-4">
          {/* Hidden fields for MaishaPay */}
          <input type="hidden" name="gatewayMode" value={gatewayMode.toString()} />
          <input type="hidden" name="publicApiKey" value={publicApiKey ?? ''} />
          <input type="hidden" name="secretApiKey" value={secretApiKey ?? ''} />
          <input type="hidden" name="montant" value={entryFee.toString()} />
          <input type="hidden" name="devise" value="USD" />
          <input type="hidden" name="callbackUrl" value={callbackUrl ?? ''} />
          
          {/* Optional fields - MaishaPay may use these */}
          <input type="hidden" name="reference" value={confirmationId} />
          <input type="hidden" name="customerEmail" value={applicantEmail} />
          <input type="hidden" name="customerName" value={applicantName ?? ''} />

          <Button
            type="submit"
            className={cn(
              'w-full h-12 text-base font-semibold',
              isLive && 'bg-emerald-600 hover:bg-emerald-700'
            )}
            size="lg"
            disabled={!hasValidConfig || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <span className="animate-spin mr-2">⏳</span>
                Redirecting...
              </>
            ) : (
              `${isLive ? 'Pay with MaishaPay' : 'Pay with MaishaPay (Test)'}`
            )}
          </Button>
        </form>

        {/* Footer Info */}
        <div className="text-center space-y-2">
          <p className="text-xs text-muted-foreground">
            🔒 You will be redirected to MaishaPay's secure checkout page
          </p>
          <p className="text-xs text-muted-foreground">
            After successful payment, you'll receive a confirmation email
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
