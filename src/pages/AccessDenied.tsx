import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldAlert, Mail, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

export default function AccessDenied() {
  const [requesting, setRequesting] = useState(false);
  const { toast } = useToast();

  const handleRequestAccess = async () => {
    setRequesting(true);
    try {
      // Get current user info
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user?.email) {
        toast({
          title: 'Error',
          description: 'You must be logged in to request access.',
          variant: 'destructive',
        });
        return;
      }

      // Send email request via edge function
      const { error } = await supabase.functions.invoke('email-service', {
        body: {
          type: 'customer_email',
          to: 'nkadimisha@afrishop-usa.com',
          subject: `Admin Access Request from ${user.email}`,
          body: `
            <h2>Admin Access Request</h2>
            <p><strong>User Email:</strong> ${user.email}</p>
            <p><strong>User ID:</strong> ${user.id}</p>
            <p><strong>Requested At:</strong> ${new Date().toISOString()}</p>
            <p>This user is requesting admin access to the AfriShop Admin Portal.</p>
            <p>To grant access, add their email to the admin_users table.</p>
          `,
        },
      });

      if (error) throw error;

      toast({
        title: 'Request Sent',
        description: 'Your access request has been sent to the administrator.',
      });
    } catch (error: any) {
      console.error('Error sending access request:', error);
      toast({
        title: 'Request Failed',
        description: 'Could not send access request. Please try again later.',
        variant: 'destructive',
      });
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <ShieldAlert className="h-16 w-16 text-destructive" />
          </div>
          <CardTitle className="text-2xl">Access Denied</CardTitle>
          <CardDescription>
            You don't have permission to access this area. Admin privileges are required.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button asChild variant="default">
            <Link to="/auth">Sign In</Link>
          </Button>
          <Button 
            variant="secondary" 
            onClick={handleRequestAccess}
            disabled={requesting}
          >
            {requesting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending Request...
              </>
            ) : (
              <>
                <Mail className="mr-2 h-4 w-4" />
                Request Access
              </>
            )}
          </Button>
          <Button asChild variant="outline">
            <Link to="/">Go to Homepage</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
