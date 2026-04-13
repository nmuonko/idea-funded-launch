import { useState } from 'react';
import { Loader2, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

interface CheckoutInlineLoginProps {
  language: string;
  shop: Record<string, string>;
}

/**
 * Guest checkout form shown on /checkout when no session exists.
 * Collects name, email, phone, and address — auto-registers the user
 * without OTP so it feels like a guest checkout.
 * Also supports existing users who can toggle to a login form.
 */
export function CheckoutInlineLogin({ language, shop }: CheckoutInlineLoginProps) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'guest' | 'login'>('guest');

  // Guest fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('DR Congo');

  // Login fields
  const [loginEmail, setLoginEmail] = useState('');
  const [password, setPassword] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isFr = language === 'fr';

  const handleGuestCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Generate a random password (user never sees this — they can reset later)
      const autoPassword = crypto.randomUUID().slice(0, 16) + 'Aa1!';

      const result = await signUp(email.trim(), autoPassword, fullName.trim(), phone.trim(), {
        country: country || 'DR Congo',
        city: city.trim() || 'Not provided',
        address_line1: address.trim() || 'Not provided',
      });

      if (result?.error) {
        const msg = result.error.message || '';
        if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('user already')) {
          setError(isFr
            ? 'Ce compte existe déjà. Connectez-vous ci-dessous.'
            : 'This account already exists. Please sign in below.');
          setLoginEmail(email);
          setMode('login');
        } else {
          setError(msg || (isFr ? 'Échec de l\'inscription' : 'Registration failed'));
        }
      }
      // On success, AuthContext sets the session → parent re-renders with checkout UI
    } catch (err: any) {
      setError(isFr ? 'Erreur de connexion' : 'Connection error');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { error: signInError } = await signIn(loginEmail.trim(), password, true);
      if (signInError) {
        const msg = signInError?.message || '';
        if (msg.includes('Invalid login')) {
          setError(isFr ? 'Email ou mot de passe incorrect' : 'Invalid email or password');
        } else {
          setError(isFr ? 'Erreur de connexion. Réessayez.' : 'Login failed. Please try again.');
        }
      }
    } catch {
      setError(isFr ? 'Erreur de connexion' : 'Connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black">
      <ShopHeader />
      <div className="pt-24 px-4 max-w-sm mx-auto pb-12">
        <div className="text-center mb-6">
          <ShoppingBag className="h-10 w-10 text-blue-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-white">
            {mode === 'guest'
              ? (isFr ? 'Finaliser votre commande' : 'Complete your order')
              : (isFr ? 'Se connecter' : 'Sign in')}
          </h2>
          <p className="text-sm text-white/50 mt-1">
            {mode === 'guest'
              ? (isFr ? 'Entrez vos coordonnées pour continuer' : 'Enter your details to continue')
              : (isFr ? 'Connectez-vous à votre compte' : 'Sign in to your account')}
          </p>
        </div>

        {mode === 'guest' ? (
          <form onSubmit={handleGuestCheckout} className="space-y-3">
            <div>
              <Label htmlFor="guest-name" className="text-white/70 text-sm">
                {isFr ? 'Nom complet' : 'Full Name'} *
              </Label>
              <Input
                id="guest-name"
                type="text"
                autoComplete="name"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="bg-white/10 border-white/20 text-white placeholder:text-white/30"
                placeholder={isFr ? 'Jean Mukendi' : 'John Doe'}
              />
            </div>
            <div>
              <Label htmlFor="guest-email" className="text-white/70 text-sm">
                Email *
              </Label>
              <Input
                id="guest-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-white/10 border-white/20 text-white placeholder:text-white/30"
                placeholder="you@email.com"
              />
            </div>
            <div>
              <Label htmlFor="guest-phone" className="text-white/70 text-sm">
                {isFr ? 'Téléphone' : 'Phone'} *
              </Label>
              <Input
                id="guest-phone"
                type="tel"
                autoComplete="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="bg-white/10 border-white/20 text-white placeholder:text-white/30"
                placeholder="+243 ..."
              />
            </div>
            <div>
              <Label htmlFor="guest-address" className="text-white/70 text-sm">
                {isFr ? 'Adresse' : 'Address'} *
              </Label>
              <Input
                id="guest-address"
                type="text"
                autoComplete="street-address"
                required
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="bg-white/10 border-white/20 text-white placeholder:text-white/30"
                placeholder={isFr ? 'Avenue, numéro, quartier' : 'Street, number, area'}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="guest-city" className="text-white/70 text-sm">
                  {isFr ? 'Ville' : 'City'} *
                </Label>
                <Input
                  id="guest-city"
                  type="text"
                  autoComplete="address-level2"
                  required
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/30"
                  placeholder="Kinshasa"
                />
              </div>
              <div>
                <Label htmlFor="guest-country" className="text-white/70 text-sm">
                  {isFr ? 'Pays' : 'Country'}
                </Label>
                <Input
                  id="guest-country"
                  type="text"
                  autoComplete="country-name"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/30"
                  placeholder="DR Congo"
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-red-400 text-center">{error}</p>
            )}

            <Button
              type="submit"
              disabled={loading || !email || !fullName || !phone || !address || !city}
              className="w-full h-12 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full disabled:opacity-50 mt-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {isFr ? 'Traitement...' : 'Processing...'}
                </>
              ) : (
                isFr ? 'Continuer vers le paiement' : 'Continue to payment'
              )}
            </Button>

            <p className="text-xs text-white/40 text-center mt-3">
              {isFr ? 'Vous avez déjà un compte ?' : 'Already have an account?'}{' '}
              <button
                type="button"
                onClick={() => { setMode('login'); setError(null); }}
                className="text-blue-400 underline"
              >
                {isFr ? 'Se connecter' : 'Sign in'}
              </button>
            </p>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <Label htmlFor="login-email" className="text-white/70 text-sm">Email</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="email"
                required
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                className="bg-white/10 border-white/20 text-white placeholder:text-white/30"
                placeholder="you@email.com"
              />
            </div>
            <div>
              <Label htmlFor="login-password" className="text-white/70 text-sm">
                {isFr ? 'Mot de passe' : 'Password'}
              </Label>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-white/10 border-white/20 text-white placeholder:text-white/30"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-sm text-red-400 text-center">{error}</p>
            )}

            <Button
              type="submit"
              disabled={loading || !loginEmail || !password}
              className="w-full h-12 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {isFr ? 'Connexion...' : 'Signing in...'}
                </>
              ) : (
                isFr ? 'Se connecter et payer' : 'Sign in & checkout'
              )}
            </Button>

            <p className="text-xs text-white/40 text-center mt-3">
              {isFr ? 'Pas de compte ?' : "Don't have an account?"}{' '}
              <button
                type="button"
                onClick={() => { setMode('guest'); setError(null); }}
                className="text-blue-400 underline"
              >
                {isFr ? 'Commander en tant qu\'invité' : 'Checkout as guest'}
              </button>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
