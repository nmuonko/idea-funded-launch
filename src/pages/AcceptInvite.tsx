import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, CheckCircle, XCircle, Eye, EyeOff, Shield } from 'lucide-react';
import { RoleBadge } from '@/components/admin/StaffRoleSelector';

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
}

export default function AcceptInvite() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const token = searchParams.get('token');
  
  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setError('Invalid invitation link - no token provided');
      setLoading(false);
      return;
    }
    
    validateToken();
  }, [token]);

  const validateToken = async () => {
    try {
      console.log('[AcceptInvite] Validating token:', token?.substring(0, 10) + '...');
      
      // Hash token client-side for secure DB lookup (never query by plaintext token)
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(token!));
      const tokenHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      
      // Query by token_hash instead of plaintext token
      const { data, error: fetchError } = await supabase
        .from('admin_invitations')
        .select('id, email, role, status, expires_at')
        .eq('token_hash', tokenHash)
        .maybeSingle();

      console.log('[AcceptInvite] Query result:', { data, error: fetchError?.message });

      if (data) {
        // We found the invitation - check its status
        if (data.status !== 'pending') {
          setError('This invitation has already been used. Please login with your credentials.');
          setLoading(false);
          return;
        }

        if (new Date(data.expires_at) < new Date()) {
          setError('This invitation has expired. Please request a new one.');
          setLoading(false);
          return;
        }

        console.log('[AcceptInvite] Token valid for:', data.email, 'role:', data.role);
        setInvitation(data);
        setLoading(false);
        return;
      }

      // If no data returned, it could be:
      // 1. Invalid token
      // 2. Expired invitation (RLS filters by expires_at > now())
      // 3. Already accepted (RLS filters by status = 'pending')
      // 
      // Try a server-side validation to get a better error message
      console.log('[AcceptInvite] No local data, trying server validation...');
      
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/accept-invitation`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            token,
            password: 'validation-check-only', // This will fail but give us the error message
            fullName: 'validation-check',
          }),
        }
      );

      const result = await response.json();
      console.log('[AcceptInvite] Server validation result:', result);

      // Check the specific error from the server
      if (result.error) {
        if (result.error.includes('already been used')) {
          setError('This invitation has already been used. Please login with your existing credentials.');
        } else if (result.error.includes('expired')) {
          setError('This invitation has expired. Please request a new one.');
        } else {
          setError(result.error);
        }
      } else {
        setError('Invalid or expired invitation link');
      }
      
      setLoading(false);
    } catch (err) {
      console.error('[AcceptInvite] Validation error:', err);
      setError('Failed to validate invitation');
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!invitation) return;
    
    if (password.length < 6) {
      toast({ title: 'Password must be at least 6 characters', variant: 'destructive' });
      return;
    }
    
    if (password !== confirmPassword) {
      toast({ title: 'Passwords do not match', variant: 'destructive' });
      return;
    }

    try {
      setSubmitting(true);
      console.log('[AcceptInvite] Submitting invitation acceptance for:', invitation.email);

      // Call the edge function to handle account creation and role assignment
      // This uses service role to bypass RLS restrictions
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/accept-invitation`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            token,
            password,
            fullName: fullName || invitation.email.split('@')[0],
          }),
        }
      );

      const result = await response.json();
      console.log('[AcceptInvite] Edge function response:', result);

      if (!response.ok) {
        if (result.redirect) {
          toast({ 
            title: 'Account already exists', 
            description: 'Please login with your existing credentials',
            variant: 'destructive' 
          });
          navigate(result.redirect);
          return;
        }
        throw new Error(result.error || 'Failed to accept invitation');
      }

      toast({
        title: 'Account created successfully!',
        description: 'You can now login to the admin portal.',
      });

      // Redirect to login
      navigate('/auth?mode=admin');

    } catch (err: any) {
      console.error('[AcceptInvite] Error:', err);
      toast({
        title: 'Failed to create account',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    const isAlreadyUsed = error.includes('already been used') || error.includes('already exists');
    
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className={`h-16 w-16 rounded-full ${isAlreadyUsed ? 'bg-primary/10' : 'bg-destructive/10'} flex items-center justify-center`}>
                {isAlreadyUsed ? (
                  <CheckCircle className="h-8 w-8 text-primary" />
                ) : (
                  <XCircle className="h-8 w-8 text-destructive" />
                )}
              </div>
              <h2 className="text-xl font-semibold">
                {isAlreadyUsed ? 'Invitation Already Accepted' : 'Invalid Invitation'}
              </h2>
              <p className="text-muted-foreground">{error}</p>
              <div className="flex gap-3">
                {isAlreadyUsed ? (
                  <Button onClick={() => navigate('/auth?mode=admin')}>
                    Login to Admin Portal
                  </Button>
                ) : (
                  <Button onClick={() => navigate('/')} variant="outline">
                    Go to Homepage
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!invitation) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Shield className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Welcome to AfriShop Admin</CardTitle>
          <CardDescription>
            You've been invited to join as <RoleBadge role={invitation.role} />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input 
                value={invitation.email} 
                disabled 
                className="bg-muted"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                placeholder="Enter your full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Create a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <Input
                id="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                placeholder="Confirm your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
            
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Creating Account...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Accept Invitation & Create Account
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
