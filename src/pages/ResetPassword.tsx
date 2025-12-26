/**
 * Password Reset Page
 * 
 * This page handles the password reset flow after user clicks the email link.
 * 
 * IMPORTANT: Supabase Dashboard → Authentication → URL Configuration
 * must allowlist: https://afrishop-usa.com/auth/reset-password
 * Otherwise redirectTo may be replaced by Site URL.
 * 
 * Flow:
 * 1. User clicks reset link in email
 * 2. Supabase redirects to /auth/reset-password#access_token=...&refresh_token=...&type=recovery
 * 3. This page parses tokens from URL hash
 * 4. Calls supabase.auth.setSession() with tokens
 * 5. Shows password form
 * 6. On submit calls supabase.auth.updateUser({ password })
 * 7. Redirects to login on success
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, KeyRound, CheckCircle } from 'lucide-react';
import afrishopLogo from '@/assets/afrishop-logo.png';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    /**
     * Parse access_token and refresh_token from URL hash.
     * If present, call supabase.auth.setSession({ access_token, refresh_token }).
     * If missing/invalid, show friendly "Lien invalide/expiré" UI and DO NOT throw.
     */
    const initializeSession = async () => {
      try {
        // Parse URL hash for recovery tokens
        const hash = window.location.hash.substring(1);
        const hashParams = new URLSearchParams(hash);
        const type = hashParams.get('type');
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');

        console.log('[ResetPassword] Checking tokens:', { type, hasAccessToken: !!accessToken, hasRefreshToken: !!refreshToken });

        // If we have recovery tokens in the hash, set the session
        if (type === 'recovery' && accessToken && refreshToken) {
          console.log('[ResetPassword] Setting session from recovery tokens');
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          
          if (sessionError) {
            console.error('[ResetPassword] Session error:', sessionError.message);
            setError('Lien invalide ou expiré. Veuillez refaire "Mot de passe oublié".');
            return;
          }
          
          // Session set successfully - ready to show form
          setSessionReady(true);
          return;
        }

        // No recovery tokens in hash - check if we already have a valid session
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session) {
          // Already have a session (maybe from previous setSession call)
          setSessionReady(true);
          return;
        }

        // No tokens and no session - invalid state
        console.log('[ResetPassword] No valid tokens or session found');
        setError('Lien invalide ou expiré. Veuillez refaire "Mot de passe oublié".');
      } catch (err) {
        // Catch any unexpected errors - DO NOT throw
        console.error('[ResetPassword] Unexpected error:', err);
        setError('Lien invalide ou expiré. Veuillez refaire "Mot de passe oublié".');
      }
    };

    initializeSession();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast({
        title: 'Error',
        description: 'Passwords do not match',
        variant: 'destructive',
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: 'Error',
        description: 'Password must be at least 6 characters',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    
    try {
      const { error } = await supabase.auth.updateUser({ password });
      
      if (error) throw error;
      
      setSuccess(true);
      toast({
        title: 'Success',
        description: 'Password updated successfully!',
      });

      // Clear URL hash
      window.history.replaceState(null, '', window.location.pathname);
      
      // Redirect after delay
      setTimeout(() => {
        navigate('/auth', { replace: true });
      }, 3000);
    } catch (err: any) {
      toast({
        title: 'Error',
        description: err.message || 'Failed to update password',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Show error state - friendly "Lien invalide/expiré" UI
  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(222,47%,8%)] via-[hsl(222,47%,11%)] to-[hsl(215,30%,15%)] p-4">
        <Card className="w-full max-w-md bg-card/50 backdrop-blur-xl border-border/30">
          <CardHeader className="text-center">
            <CardTitle className="text-destructive">Lien invalide</CardTitle>
            <CardDescription className="text-muted-foreground">
              {error}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate('/auth')} className="w-full">
              Retour à la connexion
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show success state after password update
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(222,47%,8%)] via-[hsl(222,47%,11%)] to-[hsl(215,30%,15%)] p-4">
        <Card className="w-full max-w-md bg-card/50 backdrop-blur-xl border-border/30">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4">
              <CheckCircle className="h-12 w-12 text-green-500" />
            </div>
            <CardTitle>Mot de passe mis à jour !</CardTitle>
            <CardDescription>
              Redirection vers la connexion...
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  // Show loading state while checking session
  if (!sessionReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[hsl(222,47%,8%)] via-[hsl(222,47%,11%)] to-[hsl(215,30%,15%)] p-4">
        <Card className="w-full max-w-md bg-card/50 backdrop-blur-xl border-border/30">
          <CardContent className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show password form when session is ready
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[hsl(222,47%,8%)] via-[hsl(222,47%,11%)] to-[hsl(215,30%,15%)] p-4">
      <div className="w-full max-w-md space-y-8">
        <div className="flex justify-center">
          <img src={afrishopLogo} alt="AfriShop" className="h-14 w-auto" />
        </div>

        <Card className="bg-card/50 backdrop-blur-xl border-border/30">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
              <KeyRound className="h-6 w-6 text-primary" />
            </div>
            <CardTitle>Set New Password</CardTitle>
            <CardDescription>
              Enter your new password below
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">New Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="bg-background/50 border-border/50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm">Confirm Password</Label>
                <Input
                  id="confirm"
                  type="password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  className="bg-background/50 border-border/50"
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  'Update Password'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
