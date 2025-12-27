import { useState, useEffect, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, ArrowLeft, Shield, KeyRound, AlertTriangle, Stethoscope } from 'lucide-react';
import afrishopLogo from '@/assets/afrishop-logo.png';
import { isLovablePreview } from '@/lib/environment';
import { NetworkBlockedBanner } from '@/components/NetworkBlockedBanner';

// Lazy load diagnostics panel - allow in DEV, ?debug=true, or after auth error
const SupabaseDiagnostics = lazy(() => import('@/components/admin/SupabaseDiagnostics'));
const isDev = import.meta.env.DEV;

export default function Auth() {
  const [searchParams] = useSearchParams();
  const debugParam = searchParams.get('debug') === 'true';
  const isAdminMode = searchParams.get('mode') === 'admin';
  const [showDiagnosticsPanel, setShowDiagnosticsPanel] = useState(isDev || debugParam);
  const [networkBlocked, setNetworkBlocked] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isResetPassword, setIsResetPassword] = useState(false);
  const [isUpdatePassword, setIsUpdatePassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const { signIn, checkAdminStatus } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const inPreview = isLovablePreview();
  // Detect recovery token in URL hash
  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const type = hashParams.get('type');
    
    if (type === 'recovery') {
      setIsUpdatePassword(true);
    }
  }, []);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAuthError(false);
    
    const { error, userId } = await signIn(email, password, rememberMe);
    
    if (error) {
      // Show network blocked banner on production network errors
      const isNetworkError = error.message === 'Failed to fetch' || error.name === 'TypeError';
      if (isNetworkError && !isLovablePreview()) {
        console.error('[Auth] Network error detected - showing blocked banner');
        setNetworkBlocked(true);
        setAuthError(true);
      }
      setLoading(false);
      return;
    }
    
    if (userId) {
      // Check if user is admin with retry logic for network errors
      let isAdminUser = false;
      let networkError = false;
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[Auth] Admin check attempt ${attempt}/3`);
          isAdminUser = await checkAdminStatus(userId);
          networkError = false;
          break; // Success - exit retry loop
        } catch (err: any) {
          console.error(`[Auth] Admin check attempt ${attempt} failed:`, err.message);
          networkError = true;
          if (attempt < 3) {
            // Exponential backoff: 1s, 2s
            await new Promise(r => setTimeout(r, 1000 * attempt));
          }
        }
      }
      
      if (isAdminUser) {
        navigate('/admin');
      } else if (networkError) {
        // Network error after 3 retries - DO NOT sign out, show retry option
        setAuthError(true);
        setShowDiagnosticsPanel(true);
        toast({
          title: 'Connection Error',
          description: 'Could not verify admin permissions. Please check your connection and try again.',
          variant: 'destructive',
        });
      } else {
        // Confirmed non-admin - redirect WITHOUT signing out (let them know they don't have access)
        navigate('/access-denied');
      }
    }
    setLoading(false);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      /**
       * IMPORTANT: Supabase Dashboard → Authentication → URL Configuration
       * must allowlist: https://afrishop-usa.com/auth/reset-password
       * Otherwise redirectTo may be replaced by Site URL.
       */
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: 'https://afrishop-usa.com/auth/reset-password',
      });
      
      if (error) throw error;
      
      toast({
        title: 'Success',
        description: 'Password reset link sent! Check your email.',
      });
      setIsResetPassword(false);
      setEmail('');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast({
        title: 'Error',
        description: 'Passwords do not match.',
        variant: 'destructive',
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: 'Error',
        description: 'Password must be at least 6 characters.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    
    try {
      const { error } = await supabase.auth.updateUser({ password });
      
      if (error) throw error;
      
      toast({
        title: 'Success',
        description: 'Password updated successfully! You can now sign in.',
      });
      
      // Clear the hash and reset state
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      setIsUpdatePassword(false);
      setPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-[hsl(222,47%,8%)] via-[hsl(222,47%,11%)] to-[hsl(215,30%,15%)]">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
      </div>

      {/* Header */}
      <header className="relative z-10 p-6">
        <Link to="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back to Home
        </Link>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center relative z-10 px-4 pb-12">
        <div className="w-full max-w-md space-y-8">
          {/* Logo */}
          <div className="flex justify-center animate-fade-in">
            <img 
              src={afrishopLogo} 
              alt="AfriShop - From USA to You" 
              className="h-28 md:h-36 w-auto drop-shadow-[0_0_30px_rgba(59,130,246,0.4)]"
            />
          </div>

          {/* Network Blocked Banner - shown when Supabase is unreachable */}
          {networkBlocked && (
            <NetworkBlockedBanner 
              onRetrySuccess={() => {
                setNetworkBlocked(false);
                setAuthError(false);
              }} 
            />
          )}

          {/* Diagnostics Panel - DEV, ?debug=true, or after auth error (but not if network blocked banner shown) */}
          {showDiagnosticsPanel && !networkBlocked && (
            <Suspense fallback={<div className="animate-pulse h-32 bg-muted/20 rounded-lg" />}>
              <SupabaseDiagnostics />
            </Suspense>
          )}
          
          {/* Show Run Diagnostics button if there was an auth error but panel is hidden */}
          {authError && !showDiagnosticsPanel && !networkBlocked && (
            <Button
              variant="outline"
              className="w-full border-amber-500/50 text-amber-500 hover:bg-amber-500/10"
              onClick={() => setShowDiagnosticsPanel(true)}
            >
              <Stethoscope className="mr-2 h-4 w-4" />
              Run Diagnostics
            </Button>
          )}

          {/* Preview Environment Warning */}
          {inPreview && (
            <Alert variant="destructive" className="bg-destructive/10 border-destructive/30 animate-fade-in">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                You're in the preview environment. Authentication may not work here. 
                Please test on <a href="https://afrishop-usa.com/auth" className="underline font-medium">afrishop-usa.com</a>.
              </AlertDescription>
            </Alert>
          )}

          {/* Login Card */}
          <Card className="bg-card/50 backdrop-blur-xl border-border/30 shadow-2xl animate-scale-in">
            <CardHeader className="text-center space-y-2 pb-4">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                {isUpdatePassword ? (
                  <KeyRound className="h-6 w-6 text-primary" />
                ) : (
                  <Shield className="h-6 w-6 text-primary" />
                )}
              </div>
              <CardTitle className="text-2xl font-bold text-foreground">
                {inPreview ? 'Preview Mode' : isUpdatePassword ? 'Set New Password' : isResetPassword ? 'Reset Password' : 'Admin Sign In'}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {inPreview
                  ? 'Sign in is disabled in the preview environment'
                  : isUpdatePassword
                    ? 'Enter your new password below'
                    : isResetPassword 
                      ? 'Enter your email to receive a password reset link' 
                      : 'Enter your credentials to access the dashboard'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Preview mode - show redirect to production */}
              {inPreview ? (
                <div className="space-y-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    Authentication requires the production environment. Please use the link below to sign in.
                  </p>
                  <Button asChild className="w-full h-11">
                    <a href="https://afrishop-usa.com/auth" target="_blank" rel="noopener noreferrer">
                      Go to Production Sign In
                    </a>
                  </Button>
                </div>
              ) : isUpdatePassword ? (
                <form onSubmit={handleUpdatePassword} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="new-password">New Password</Label>
                    <Input
                      id="new-password"
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
                    <Label htmlFor="confirm-password">Confirm Password</Label>
                    <Input
                      id="confirm-password"
                      type="password"
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                      minLength={6}
                      className="bg-background/50 border-border/50"
                    />
                  </div>
                  <Button type="submit" className="w-full h-11" disabled={loading}>
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
              ) : isResetPassword ? (
                <form onSubmit={handleResetPassword} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="reset-email">Email</Label>
                    <Input
                      id="reset-email"
                      type="email"
                      placeholder="admin@afrishop.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="bg-background/50 border-border/50"
                    />
                  </div>
                  <Button type="submit" className="w-full h-11" disabled={loading}>
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      'Send Reset Link'
                    )}
                  </Button>
                  <Button 
                    type="button" 
                    variant="ghost" 
                    className="w-full text-muted-foreground hover:text-foreground" 
                    onClick={() => setIsResetPassword(false)}
                  >
                    Back to Sign In
                  </Button>
                </form>
              ) : (
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="admin-email">Email</Label>
                    <Input
                      id="admin-email"
                      type="email"
                      placeholder="admin@afrishop.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="bg-background/50 border-border/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="admin-password">Password</Label>
                    <Input
                      id="admin-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className="bg-background/50 border-border/50"
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="remember-me"
                      checked={rememberMe}
                      onCheckedChange={(checked) => setRememberMe(checked === true)}
                    />
                    <Label 
                      htmlFor="remember-me" 
                      className="text-sm font-normal text-muted-foreground cursor-pointer"
                    >
                      Remember me
                    </Label>
                  </div>
                  <Button type="submit" className="w-full h-11" disabled={loading}>
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      'Sign In'
                    )}
                  </Button>
                  <Button 
                    type="button" 
                    variant="ghost" 
                    className="w-full text-muted-foreground hover:text-foreground" 
                    onClick={() => setIsResetPassword(true)}
                  >
                    Forgot Password?
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          {/* Footer note */}
          <p className="text-xs text-center text-muted-foreground/60 animate-fade-in" style={{ animationDelay: '0.3s' }}>
            Access restricted to authorized administrators only.
            <br />
            Contact support if you need assistance.
          </p>
        </div>
      </main>
    </div>
  );
}
