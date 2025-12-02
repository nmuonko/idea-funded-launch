import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Shield } from 'lucide-react';
import afrishopLogo from '@/assets/afrishop-logo.png';

export default function Auth() {
  const [searchParams] = useSearchParams();
  const isAdminMode = searchParams.get('mode') === 'admin';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isResetPassword, setIsResetPassword] = useState(false);
  const { signIn, checkAdminStatus } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error, userId } = await signIn(email, password);
    
    if (!error && userId) {
      // Check if user is admin using the returned userId
      const isAdminUser = await checkAdminStatus(userId);
      if (isAdminUser) {
        navigate('/admin');
      } else {
        toast({
          title: 'Access Denied',
          description: 'You do not have admin privileges.',
          variant: 'destructive',
        });
        // Sign out if not admin
        await supabase.auth.signOut();
      }
    }
    setLoading(false);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth?mode=admin`,
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
              className="h-14 md:h-16 w-auto"
            />
          </div>

          {/* Login Card */}
          <Card className="bg-card/50 backdrop-blur-xl border-border/30 shadow-2xl animate-scale-in">
            <CardHeader className="text-center space-y-2 pb-4">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-2xl font-bold text-foreground">
                {isResetPassword ? 'Reset Password' : 'Admin Sign In'}
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                {isResetPassword 
                  ? 'Enter your email to receive a password reset link' 
                  : 'Enter your credentials to access the dashboard'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isResetPassword ? (
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
