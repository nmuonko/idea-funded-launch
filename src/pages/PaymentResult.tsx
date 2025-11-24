import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Home, Search, Copy, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { ProgressIndicator } from '@/components/ProgressIndicator';
import { toast } from 'sonner';

export default function PaymentResult() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [confirmationId, setConfirmationId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const status = searchParams.get('status') ?? '';
  const description = searchParams.get('description') ?? '';
  const transactionRefId = searchParams.get('transactionRefId') ?? '';
  const operatorRefId = searchParams.get('operatorRefId') ?? '';
  const reference = searchParams.get('reference') ?? ''; // Confirmation ID from MaishaPay

  // Determine if payment was successful
  const normalizedStatus = status.toLowerCase();
  const isSuccess =
    normalizedStatus === '202' ||
    normalizedStatus === 'success' ||
    normalizedStatus === 'paid' ||
    normalizedStatus.includes('success');

  useEffect(() => {
    const processPayment = async () => {
      if (!reference) {
        setLoading(false);
        return;
      }

      try {
        // Fetch submission by confirmation ID
        const { data: submission, error: fetchError } = await supabase
          .from('user_submissions')
          .select('*')
          .eq('confirmation_id', reference)
          .maybeSingle();

        if (fetchError || !submission) {
          console.error('Error fetching submission:', fetchError);
          setLoading(false);
          return;
        }

        setConfirmationId(submission.confirmation_id);

        const entryFee = submission.payment_amount || 20;

        if (isSuccess) {
          // Update submission to mark as paid and submitted
          const { error: updateError } = await supabase
            .from('user_submissions')
            .update({
              payment_status: 'paid',
              payment_ref_id: transactionRefId,
              payment_operator_id: operatorRefId,
              submitted_at: new Date().toISOString(),
              is_draft: false,
            })
            .eq('id', submission.id);

          if (updateError) {
            console.error('Error updating submission:', updateError);
          }

          // Insert payment record
          const { error: paymentError } = await supabase.from('payments').insert({
            confirmation_id: reference,
            provider: 'maishapay',
            status,
            description,
            transaction_ref_id: transactionRefId,
            operator_ref_id: operatorRefId,
            amount: entryFee,
            currency: 'USD',
            applicant_email: submission.email,
            applicant_name: submission.full_name,
          });

          if (paymentError) {
            console.error('Error inserting payment record:', paymentError);
          }

          // Trigger AI analysis in background
          supabase.functions
            .invoke('analyze-submission', {
              body: { submissionId: submission.id },
            })
            .then(() => {
              console.log('AI analysis triggered');
            })
            .catch((err) => {
              console.error('Failed to trigger AI analysis:', err);
            });

          // Send success emails
          supabase.functions
            .invoke('send-application-emails', {
              body: { confirmationId: reference, type: 'success' },
            })
            .then(() => {
              console.log('Success emails sent');
            })
            .catch((err) => {
              console.error('Failed to send emails:', err);
            });
        } else {
          // Update submission as failed
          const { error: updateError } = await supabase
            .from('user_submissions')
            .update({
              payment_status: 'failed',
            })
            .eq('id', submission.id);

          if (updateError) {
            console.error('Error updating submission:', updateError);
          }

          // Send failure email
          supabase.functions
            .invoke('send-application-emails', {
              body: { confirmationId: reference, type: 'failure' },
            })
            .then(() => {
              console.log('Failure email sent');
            })
            .catch((err) => {
              console.error('Failed to send failure email:', err);
            });
        }
      } catch (err) {
        console.error('Error in processPayment:', err);
      } finally {
        setLoading(false);
      }
    };

    processPayment();
  }, [reference, isSuccess, status, description, transactionRefId, operatorRefId]);

  const copyConfirmationId = () => {
    if (confirmationId) {
      navigator.clipboard.writeText(confirmationId);
      setCopied(true);
      toast.success('Confirmation ID copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground">Processing payment...</p>
        </div>
      </div>
    );
  }

  if (!reference || !confirmationId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Payment Information Missing</CardTitle>
            <CardDescription>
              We couldn't find the payment details. Please try again or contact support.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate('/apply')} className="w-full">
              Return to Application
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-3xl space-y-6">
        {/* Progress Indicator */}
        <ProgressIndicator
          steps={[
            { label: 'Project Details', description: 'Application form' },
            { label: 'Payment', description: 'Entry fee' },
            { label: 'Confirmation', description: 'Track status' },
          ]}
          currentStep={2}
        />

        {/* Main Status Card */}
        <Card className={isSuccess ? 'border-emerald-500 border-2' : 'border-red-500 border-2'}>
          <CardHeader>
            <div className="flex items-center gap-3">
              {isSuccess ? (
                <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              ) : (
                <XCircle className="h-10 w-10 text-red-500" />
              )}
              <div>
                <CardTitle className={isSuccess ? 'text-emerald-700' : 'text-red-700'}>
                  {isSuccess ? '🎉 Payment Successful!' : '❌ Payment Failed'}
                </CardTitle>
                <CardDescription>
                  {isSuccess
                    ? 'Your project has been successfully submitted to AfriFund.'
                    : 'Your payment could not be processed. Your project has NOT been submitted yet.'}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isSuccess ? (
              <div className="space-y-4">
                {/* Confirmation ID Display */}
                <div className="p-4 bg-emerald-50 dark:bg-emerald-950 rounded-lg border-2 border-emerald-200 dark:border-emerald-800">
                  <label className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                    Your Confirmation ID:
                  </label>
                  <div className="flex items-center gap-2 mt-2">
                    <code className="flex-1 text-xl font-mono font-bold text-emerald-700 dark:text-emerald-300">
                      {confirmationId}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={copyConfirmationId}
                      className="shrink-0"
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-2">
                    ⚠️ <strong>Keep this ID safe!</strong> Use it to track your application status on
                    the Results page.
                  </p>
                </div>

                {/* What's Next */}
                <div className="space-y-2">
                  <h3 className="font-semibold">What's Next?</h3>
                  <ol className="list-decimal list-inside space-y-1 text-sm text-muted-foreground">
                    <li>Check your email for payment confirmation</li>
                    <li>Our team will review your application</li>
                    <li>You'll receive updates via email</li>
                    <li>Track your status using your Confirmation ID</li>
                  </ol>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {description ||
                    'The payment was cancelled or encountered an error. Please try again or contact support if the problem persists.'}
                </p>
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-xs text-muted-foreground">
                    Your Confirmation ID: <strong>{confirmationId}</strong>
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment Details Card */}
        {(transactionRefId || operatorRefId) && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payment Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {status && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Status:</span>
                    <span className="font-medium">{status}</span>
                  </div>
                )}
                {transactionRefId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Transaction ID:</span>
                    <span className="font-mono text-xs">{transactionRefId}</span>
                  </div>
                )}
                {operatorRefId && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Operator Reference:</span>
                    <span className="font-mono text-xs">{operatorRefId}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button onClick={() => navigate('/')} variant="outline" className="flex-1">
            <Home className="mr-2 h-4 w-4" />
            Back to Home
          </Button>
          {isSuccess ? (
            <Button
              onClick={() => navigate(`/results?ref=${confirmationId}`)}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700"
            >
              <Search className="mr-2 h-4 w-4" />
              Track Application
            </Button>
          ) : (
            <Button onClick={() => navigate('/apply')} className="flex-1" variant="destructive">
              Try Payment Again
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
