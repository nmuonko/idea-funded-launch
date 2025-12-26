import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, Link, ExternalLink, Copy, Check, Shield } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

// Check if dev mode is enabled
const isDevMode = import.meta.env.DEV || import.meta.env.VITE_DEV_TOOLS === 'true';

export default function PaymentLinkTest() {
  const navigate = useNavigate();
  const [orderId, setOrderId] = useState('');
  const [loading, setLoading] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    checkAdminStatus();
  }, []);

  const checkAdminStatus = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setCheckingAuth(false);
        return;
      }

      const { data: role } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .eq('role', 'admin')
        .maybeSingle();

      setIsAdmin(!!role);
    } catch (err) {
      console.error('Error checking admin status:', err);
    } finally {
      setCheckingAuth(false);
    }
  };

  // Only allow access in dev mode or for admins
  if (!isDevMode && !checkingAuth && !isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
              <Shield className="h-8 w-8 text-destructive" />
            </div>
            <CardTitle>Access Denied</CardTitle>
            <CardDescription>
              This page is only available in development mode or for administrators.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate('/')} variant="outline" className="w-full">
              Return Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const handleCreateLink = async () => {
    if (!orderId.trim()) {
      toast.error('Please enter an order ID');
      return;
    }

    setLoading(true);
    setGeneratedUrl(null);
    setGeneratedToken(null);

    try {
      const { data: result, error: invokeError } = await supabase.functions.invoke('create-payment-link', {
        body: { order_id: orderId.trim() },
      });

      if (invokeError) {
        console.error('Error creating payment link:', invokeError);
        toast.error('Failed to create payment link');
        return;
      }

      if (!result.success) {
        toast.error(result.error || 'Failed to create payment link');
        return;
      }

      const token = result.token;
      const url = `${window.location.origin}/pay/${token}`;
      
      setGeneratedToken(token);
      setGeneratedUrl(url);
      toast.success('Payment link created successfully!');
    } catch (err) {
      console.error('Exception creating payment link:', err);
      toast.error('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    if (generatedUrl) {
      navigator.clipboard.writeText(generatedUrl);
      setCopied(true);
      toast.success('Copied to clipboard!');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const openLink = () => {
    if (generatedToken) {
      navigate(`/pay/${generatedToken}`);
    }
  };

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        {/* Header */}
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
              <Link className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">Payment Link Tester</CardTitle>
            <CardDescription>
              Create and test payment links for orders
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Dev Mode Warning */}
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Development Tool</AlertTitle>
          <AlertDescription>
            This page is for testing payment links. It is only accessible in development mode or for administrators.
          </AlertDescription>
        </Alert>

        {/* Create Link Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Create Payment Link</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="orderId">Order ID (UUID)</Label>
              <Input
                id="orderId"
                placeholder="e.g., a1b2c3d4-e5f6-7890-abcd-ef1234567890"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                Enter a valid order ID from your database. The order must be in PENDING_PAYMENT status.
              </p>
            </div>

            <Button 
              onClick={handleCreateLink} 
              disabled={loading || !orderId.trim()}
              className="w-full"
            >
              {loading ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  Creating...
                </>
              ) : (
                <>
                  <Link className="mr-2 h-4 w-4" />
                  Create Payment Link
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Generated Link */}
        {generatedUrl && (
          <Card className="border-green-500/50 bg-green-500/5">
            <CardHeader>
              <CardTitle className="text-lg text-green-700 dark:text-green-400">
                ✅ Payment Link Created
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Generated URL</Label>
                <div className="flex gap-2">
                  <Input
                    value={generatedUrl}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={copyToClipboard}
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Token</Label>
                <code className="block bg-muted rounded px-3 py-2 text-xs font-mono break-all">
                  {generatedToken}
                </code>
              </div>

              <Button onClick={openLink} className="w-full">
                <ExternalLink className="mr-2 h-4 w-4" />
                Open Payment Link
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Instructions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">How to Use</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>1. Find an order ID from the admin panel or database</p>
            <p>2. The order must be in PENDING_PAYMENT or DRAFT status</p>
            <p>3. Paste the order ID above and click "Create Payment Link"</p>
            <p>4. Use the generated link to test the payment flow</p>
          </CardContent>
        </Card>

        {/* Back Button */}
        <Button variant="outline" onClick={() => navigate('/')} className="w-full">
          Return Home
        </Button>
      </div>
    </div>
  );
}
