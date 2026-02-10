import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, UserProfile } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, AlertCircle, Mail, Lock, LogOut, MapPin } from 'lucide-react';

const DRC_PROVINCES = [
  'Kinshasa', 'Kongo-Central', 'Kwango', 'Kwilu', 'Mai-Ndombe',
  'Équateur', 'Mongala', 'Nord-Ubangi', 'Sud-Ubangi', 'Tshuapa',
  'Tshopo', 'Bas-Uélé', 'Haut-Uélé', 'Ituri', 'Nord-Kivu',
  'Sud-Kivu', 'Maniema', 'Haut-Katanga', 'Haut-Lomami', 'Lualaba',
  'Tanganika', 'Lomami', 'Kasaï-Oriental', 'Sankuru', 'Kasaï',
  'Kasaï-Central',
];

export default function Profile() {
  const { user, profile, setProfile, loadProfile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [sendingVerification, setSendingVerification] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [stateProvince, setStateProvince] = useState('');
  const [country, setCountry] = useState('DR Congo');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/auth');
      return;
    }
    
    // Initialize form from profile in context or load if not available
    if (profile) {
      setName(profile.full_name || profile.name || '');
      setPhone(profile.phone || '');
      setAddressLine1((profile as any).address_line1 || '');
      setAddressLine2((profile as any).address_line2 || '');
      setCity((profile as any).city || '');
      setStateProvince((profile as any).state_province || '');
      setCountry((profile as any).country || 'DR Congo');
    } else {
      // Load profile if not in context
      loadProfile(user.id).then((loadedProfile) => {
        if (loadedProfile) {
          setName(loadedProfile.full_name || loadedProfile.name || '');
          setPhone(loadedProfile.phone || '');
        } else {
          // Fallback to user_metadata
          const userMetadata = user.user_metadata || {};
          setName(userMetadata.full_name || '');
          setPhone(userMetadata.phone || '');
        }
      });
    }
  }, [user, profile, navigate, loadProfile]);

  const handleResendVerification = async () => {
    if (!user?.email) return;
    
    try {
      setSendingVerification(true);
      const response = await supabase.functions.invoke('auth-resend-verification', {
        body: {
          email: user.email,
          redirectBaseUrl: window.location.origin,
        },
      });

      if (response.error) throw response.error;
      const result = response.data;
      if (result && !result.ok) throw new Error(result.message);

      toast({
        title: 'Verification Email Sent',
        description: 'Please check your inbox and verify your email address.',
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSendingVerification(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      toast({
        title: 'Error',
        description: 'New passwords do not match.',
        variant: 'destructive',
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: 'Error',
        description: 'Password must be at least 6 characters long.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setChangingPassword(true);
      
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Password updated successfully!',
      });

      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setChangingPassword(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    setLoading(true);

    try {
      const updatedData = {
        user_id: user.id,
        email: user.email?.toLowerCase() || null,
        name,
        full_name: name,
        phone,
        address_line1: addressLine1 || null,
        address_line2: addressLine2 || null,
        city: city || null,
        state_province: stateProvince || null,
        country: country || 'DR Congo',
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('profiles')
        .upsert(updatedData, {
          onConflict: 'user_id',
        })
        .select()
        .single();

      if (error) throw error;

      // Update profile in global context
      if (data) {
        setProfile(data as UserProfile);
      }

      toast({
        title: 'Success',
        description: 'Profile updated successfully!',
      });

      // Navigate back if came from somewhere else, otherwise stay
      if (window.history.length > 1) {
        // Don't navigate back to avoid redirect loops
      }
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

  if (!user) return null;

  const getInitials = () => {
    if (name) {
      return name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return user.email?.charAt(0)?.toUpperCase() || '?';
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto py-8 px-4">
        {/* Email Verification Banner */}
        {user && !user.email_confirmed_at && (
          <Alert className="mb-6 border-amber-500 bg-amber-50 dark:bg-amber-950">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertDescription className="flex items-center justify-between">
              <span className="text-amber-800 dark:text-amber-200">
                Please verify your email address to access all features.
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handleResendVerification}
                disabled={sendingVerification}
                className="ml-4 border-amber-600 text-amber-700 hover:bg-amber-100 dark:border-amber-400 dark:text-amber-300"
              >
                {sendingVerification ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    Resend Email
                  </>
                )}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Profile Settings</CardTitle>
            <CardDescription>Manage your account information</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="flex flex-col items-center space-y-4">
                <Avatar className="h-24 w-24">
                  <AvatarFallback className="text-2xl font-semibold bg-primary text-primary-foreground">
                    {getInitials()}
                  </AvatarFallback>
                </Avatar>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={user.email || ''}
                  disabled
                  className="bg-muted"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter your full name"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Enter your phone number"
                />
              </div>

              <Separator className="my-6" />

              {/* Address Section */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-primary" />
                  <h3 className="text-lg font-semibold">Shipping Address</h3>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="addressLine1">Address Line 1</Label>
                  <Input
                    id="addressLine1"
                    value={addressLine1}
                    onChange={(e) => setAddressLine1(e.target.value)}
                    placeholder="Street address"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="addressLine2">Address Line 2 (Optional)</Label>
                  <Input
                    id="addressLine2"
                    value={addressLine2}
                    onChange={(e) => setAddressLine2(e.target.value)}
                    placeholder="Apartment, suite, etc."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="city">City</Label>
                    <Input
                      id="city"
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="City"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="stateProvince">Province</Label>
                    <Select value={stateProvince} onValueChange={setStateProvince}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select province" />
                      </SelectTrigger>
                      <SelectContent>
                        {DRC_PROVINCES.map((prov) => (
                          <SelectItem key={prov} value={prov}>{prov}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="country">Country</Label>
                  <Input
                    id="country"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    placeholder="Country"
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </form>

            <Separator className="my-8" />

            {/* Password Change Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Lock className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold">Change Password</h3>
              </div>
              <form onSubmit={handlePasswordChange} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="newPassword">New Password</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password (min 6 characters)"
                    minLength={6}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm New Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    minLength={6}
                    required
                  />
                </div>

                <Button 
                  type="submit" 
                  className="w-full" 
                  disabled={changingPassword || !newPassword || !confirmPassword}
                >
                  {changingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Update Password
                </Button>
              </form>
            </div>

            <Separator className="my-8" />

            {/* Disconnect */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <LogOut className="h-5 w-5 text-destructive" />
                <h3 className="text-lg font-semibold">Déconnexion / Disconnect</h3>
              </div>
              <Button
                variant="destructive"
                className="w-full"
                onClick={async () => {
                  await supabase.auth.signOut();
                  navigate('/');
                }}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Se déconnecter / Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
