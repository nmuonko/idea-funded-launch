import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Processing authentication...');

  useEffect(() => {
    const handleCallback = async () => {
      try {
        console.log('[AuthCallback] Processing callback...');
        console.log('[AuthCallback] URL:', window.location.href);
        
        // Check URL hash for tokens (email verification & OAuth)
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        const type = hashParams.get('type');
        const errorDescription = hashParams.get('error_description');
        
        // Check for OAuth error in URL
        if (errorDescription) {
          console.error('[AuthCallback] OAuth error:', errorDescription);
          setStatus('error');
          setMessage(decodeURIComponent(errorDescription));
          return;
        }

        // Determine if this is OAuth or email verification
        const isOAuth = type === 'signup' || type === 'magiclink' || (!type && accessToken);
        const isEmailVerification = type === 'email' || type === 'signup';
        
        console.log('[AuthCallback] Auth type:', { type, isOAuth, isEmailVerification });

        // If we have tokens in the hash, set the session
        if (accessToken && refreshToken) {
          console.log('[AuthCallback] Setting session from URL tokens...');
          const { data, error: setSessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });

          if (setSessionError) {
            console.error('[AuthCallback] Failed to set session:', setSessionError);
            setStatus('error');
            setMessage(setSessionError.message);
            return;
          }

          if (data.session?.user) {
            console.log('[AuthCallback] Session established for:', data.session.user.email);
            
            // Create/update profile for OAuth users
            await ensureProfileExists(data.session.user);
            
            // Check if user is admin
            const isAdmin = await checkAdminStatus(data.session.user.id);
            
            setStatus('success');
            setMessage('Authentication successful! Redirecting...');
            
            // Clear the hash from URL
            window.history.replaceState(null, '', window.location.pathname);
            
            // Redirect based on admin status
            setTimeout(() => {
              if (isAdmin) {
                navigate('/admin', { replace: true });
              } else {
                navigate('/', { replace: true });
              }
            }, 1500);
            return;
          }
        }

        // Fallback: try to get existing session
        const { data: { session }, error } = await supabase.auth.getSession();

        if (error) {
          console.error('[AuthCallback] Error getting session:', error);
          setStatus('error');
          setMessage(error.message || 'Authentication failed');
          return;
        }

        if (session?.user) {
          console.log('[AuthCallback] Found existing session for:', session.user.email);
          
          await ensureProfileExists(session.user);
          const isAdmin = await checkAdminStatus(session.user.id);
          
          setStatus('success');
          setMessage('Authentication successful! Redirecting...');
          
          setTimeout(() => {
            if (isAdmin) {
              navigate('/admin', { replace: true });
            } else {
              navigate('/', { replace: true });
            }
          }, 1500);
        } else {
          setStatus('error');
          setMessage('No authentication session found. Please try again.');
        }
      } catch (err: any) {
        console.error('[AuthCallback] Exception:', err);
        setStatus('error');
        setMessage(err.message || 'An unexpected error occurred');
      }
    };

    // Helper to ensure profile exists for OAuth users
    const ensureProfileExists = async (user: any) => {
      try {
        console.log('[AuthCallback] Ensuring profile exists for:', user.id);
        
        // Check if profile already exists
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('user_id', user.id)
          .maybeSingle();

        if (existingProfile) {
          console.log('[AuthCallback] Profile already exists');
          return;
        }

        // Create profile for OAuth user
        const fullName = user.user_metadata?.full_name || 
                         user.user_metadata?.name || 
                         user.email?.split('@')[0] || 
                         'User';
        
        const { error: profileError } = await supabase
          .from('profiles')
          .upsert({
            user_id: user.id,
            email: user.email,
            full_name: fullName,
            name: fullName,
          }, {
            onConflict: 'user_id',
          });

        if (profileError) {
          console.error('[AuthCallback] Error creating profile:', profileError);
        } else {
          console.log('[AuthCallback] Profile created successfully');
        }
      } catch (err) {
        console.error('[AuthCallback] Exception creating profile:', err);
      }
    };

    // Helper to check admin status
    const checkAdminStatus = async (userId: string): Promise<boolean> => {
      try {
        const { data } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', userId)
          .eq('role', 'admin')
          .maybeSingle();

        return data?.role === 'admin';
      } catch (err) {
        console.error('[AuthCallback] Error checking admin status:', err);
        return false;
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
