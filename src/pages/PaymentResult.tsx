import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Loader2, TestTube } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { supabase } from '@/integrations/supabase/client';

export default function PaymentResult() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [submission, setSubmission] = useState<any>(null);

  const status = searchParams.get('status');
  const reference = searchParams.get('reference');

  useEffect(() => {
    const loadSubmission = async () => {
      if (!reference) {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('user_submissions')
          .select('*')
          .eq('maishapay_reference', reference)
          .single();

        if (error) throw error;
        setSubmission(data);
      } catch (error) {
        console.error('Error loading submission:', error);
      } finally {
        setLoading(false);
      }
    };

    loadSubmission();
  }, [reference]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Loading payment status...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isSuccess = status === 'paid' || submission?.payment_status === 'paid';

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-b from-background to-muted/20">
      <Card className="max-w-2xl w-full shadow-elegant">
        <CardHeader className="text-center space-y-4">
          <div className="flex justify-center">
            <div className={`h-20 w-20 rounded-full flex items-center justify-center ${
              isSuccess ? 'bg-success/20' : 'bg-destructive/20'
            }`}>
              {isSuccess ? (
                <CheckCircle2 className="h-10 w-10 text-success animate-scale-in" />
              ) : (
                <XCircle className="h-10 w-10 text-destructive animate-scale-in" />
              )}
            </div>
          </div>
          <div className="flex items-center justify-center gap-2">
            <CardTitle className="text-3xl">
              {isSuccess ? 'Payment Successful!' : 'Payment Failed'}
            </CardTitle>
            <TestTube className="h-6 w-6 text-warning" />
          </div>
          <CardDescription className="text-base">
            {isSuccess
              ? 'Your payment has been processed successfully (TEST MODE)'
              : 'We could not process your payment (TEST MODE)'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <Alert className="bg-warning/10 border-warning">
            <TestTube className="h-4 w-4 text-warning" />
            <AlertDescription>
              <strong>SANDBOX TEST MODE:</strong> This is a test payment. No real money was charged.
            </AlertDescription>
          </Alert>

          {submission && (
            <Card className="bg-muted/50">
              <CardContent className="p-6 space-y-3">
                <h3 className="font-semibold text-lg mb-3">Payment Details</h3>
                
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Reference</p>
                    <p className="font-mono font-semibold">{submission.maishapay_reference}</p>
                  </div>
                  
                  {submission.project_code && (
                    <div>
                      <p className="text-muted-foreground">Project Code</p>
                      <p className="font-mono font-semibold text-primary">{submission.project_code}</p>
                    </div>
                  )}
                  
                  <div>
                    <p className="text-muted-foreground">Amount</p>
                    <p className="font-semibold">${submission.payment_amount} {submission.payment_currency}</p>
                  </div>
                  
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <p className={`font-semibold ${
                      isSuccess ? 'text-success' : 'text-destructive'
                    }`}>
                      {submission.payment_status.toUpperCase()}
                    </p>
                  </div>
                  
                  <div className="col-span-2">
                    <p className="text-muted-foreground">Project Title</p>
                    <p className="font-semibold">{submission.project_title}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {isSuccess && (
            <div className="space-y-3 bg-success/10 p-4 rounded-lg border border-success/20">
              <h4 className="font-semibold text-success">What's Next?</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>✅ Your submission has been received</li>
                <li>✅ Your project code has been generated</li>
                <li>✅ You can track your application status using your project code</li>
                <li>📧 A confirmation email has been sent to your registered email</li>
              </ul>
            </div>
          )}

          {!isSuccess && (
            <div className="space-y-3 bg-destructive/10 p-4 rounded-lg border border-destructive/20">
              <h4 className="font-semibold text-destructive">What Should You Do?</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• Check your payment details and try again</li>
                <li>• Contact support if the issue persists</li>
                <li>• Your application is saved and can be completed later</li>
              </ul>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => navigate('/')}
            >
              Go Home
            </Button>
            {isSuccess ? (
              <Button
                className="flex-1"
                onClick={() => navigate('/results')}
              >
                Track Application
              </Button>
            ) : (
              <Button
                className="flex-1"
                onClick={() => navigate('/apply')}
              >
                Try Again
              </Button>
            )}
          </div>

          <p className="text-xs text-center text-muted-foreground">
            If you have any questions, please contact our support team
          </p>
        </CardContent>
      </Card>
    </div>
  );
}