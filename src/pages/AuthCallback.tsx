import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Verifying your email...');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Get the session from URL hash (Supabase puts tokens there after email verification)
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          console.error('[AuthCallback] Error:', error);
          setStatus('error');
          setMessage(error.message || 'Email verification failed');
          return;
        }

        if (session) {
          console.log('[AuthCallback] Email verified successfully');
          setStatus('success');
          setMessage('Email verified successfully! Redirecting...');
          
          // Redirect to home or orders page after short delay
          setTimeout(() => {
            navigate('/', { replace: true });
          }, 2000);
        } else {
          // No session but no error - might be checking session too early
          // Try to exchange the tokens from the URL
          const hashParams = new URLSearchParams(window.location.hash.substring(1));
          const accessToken = hashParams.get('access_token');
          const refreshToken = hashParams.get('refresh_token');

          if (accessToken && refreshToken) {
            const { error: setSessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });

            if (setSessionError) {
              setStatus('error');
              setMessage(setSessionError.message);
            } else {
              setStatus('success');
              setMessage('Email verified successfully! Redirecting...');
              setTimeout(() => {
                navigate('/', { replace: true });
              }, 2000);
            }
          } else {
            setStatus('error');
            setMessage('Invalid verification link');
          }
        }
      } catch (err: any) {
        console.error('[AuthCallback] Exception:', err);
        setStatus('error');
        setMessage(err.message || 'An unexpected error occurred');
      }
    };

    handleCallback();
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(222,47%,8%)] via-[hsl(222,47%,11%)] to-[hsl(215,30%,15%)] p-4">
      <Card className="w-full max-w-md bg-card/50 backdrop-blur-xl border-border/30">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            {status === 'loading' && (
              <Loader2 className="h-12 w-12 text-primary animate-spin" />
            )}
            {status === 'success' && (
              <CheckCircle className="h-12 w-12 text-green-500" />
            )}
            {status === 'error' && (
              <XCircle className="h-12 w-12 text-destructive" />
            )}
          </div>
          <CardTitle className="text-xl">
            {status === 'loading' && 'Verifying Email'}
            {status === 'success' && 'Email Verified!'}
            {status === 'error' && 'Verification Failed'}
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        {status === 'error' && (
          <CardContent className="flex flex-col gap-2">
            <Button onClick={() => navigate('/auth')} variant="default">
              Back to Sign In
            </Button>
            <Button onClick={() => navigate('/')} variant="ghost">
              Go to Home
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
