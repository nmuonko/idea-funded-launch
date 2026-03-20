import { useState } from 'react';
import { Loader2, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { useAuth } from '@/contexts/AuthContext';

interface CheckoutInlineLoginProps {
  language: string;
  shop: Record<string, string>;
}

/**
 * Inline login form shown on /checkout when no session exists.
 * After successful login, the component unmounts (session becomes non-null)
 * and the parent Checkout component renders the real checkout UI.
 *
 * This avoids redirecting to /shop-auth, which confuses users in WebView
 * contexts where the RN native login doesn't share localStorage.
 */
export function CheckoutInlineLogin({ language, shop }: CheckoutInlineLoginProps) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isFr = language === 'fr';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const { error: signInError } = await signIn(email.trim(), password, true);
      if (signInError) {
        const msg = signInError?.message || '';
        if (msg.includes('Invalid login')) {
          setError(isFr ? 'Email ou mot de passe incorrect' : 'Invalid email or password');
        } else if (msg.includes('Email not confirmed')) {
          setError(isFr ? 'Veuillez confirmer votre email' : 'Please confirm your email first');
        } else {
          setError(isFr ? 'Erreur de connexion. Réessayez.' : 'Login failed. Please try again.');
        }
      }
      // On success, AuthContext updates session → parent re-renders with checkout UI
    } catch {
      setError(isFr ? 'Erreur de connexion' : 'Connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black">
      <ShopHeader />
      <div className="pt-24 px-4 max-w-sm mx-auto">
        <div className="text-center mb-6">
          <LogIn className="h-10 w-10 text-blue-400 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-white">
            {isFr ? 'Connectez-vous pour payer' : 'Sign in to checkout'}
          </h2>
          <p className="text-sm text-white/50 mt-1">
            {isFr
              ? 'Entrez vos identifiants pour continuer'
              : 'Enter your credentials to continue'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="checkout-email" className="text-white/70 text-sm">
              {isFr ? 'Email' : 'Email'}
            </Label>
            <Input
              id="checkout-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-white/10 border-white/20 text-white placeholder:text-white/30"
              placeholder={isFr ? 'votre@email.com' : 'you@email.com'}
            />
          </div>
          <div>
            <Label htmlFor="checkout-password" className="text-white/70 text-sm">
              {isFr ? 'Mot de passe' : 'Password'}
            </Label>
            <Input
              id="checkout-password"
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
            disabled={loading || !email || !password}
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
        </form>
      </div>
    </div>
  );
}
