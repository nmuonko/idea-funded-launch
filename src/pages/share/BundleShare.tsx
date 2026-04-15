import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Package, ArrowLeft, CreditCard, ShoppingBag } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useShopCart } from '@/contexts/ShopCartContext';
import { formatCurrency } from '@/lib/formatCurrency';

interface BundleData {
  id: string;
  title: string;
  description: string | null;
  expires_at: string | null;
  is_active: boolean;
}

interface BundleItemData {
  id: string;
  title: string;
  price_usd: number;
  image_url: string | null;
  product_url: string | null;
  sort_order: number;
}

export default function BundleShare() {
  const { bundleId } = useParams<{ bundleId: string }>();
  const navigate = useNavigate();
  const { user, signUp, signIn } = useAuth();
  const [bundle, setBundle] = useState<BundleData | null>(null);
  const [items, setItems] = useState<BundleItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Checkout form state
  const [showCheckout, setShowCheckout] = useState(false);
  const [mode, setMode] = useState<'guest' | 'login'>('guest');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('DR Congo');
  const [loginEmail, setLoginEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!bundleId) return;
    (async () => {
      const { data: b } = await supabase
        .from('product_bundles')
        .select('id, title, description, expires_at, is_active')
        .eq('id', bundleId)
        .single();

      if (!b) { setLoading(false); return; }
      setBundle(b);

      const { data: itemsData } = await supabase
        .from('product_bundle_items')
        .select('id, title, price_usd, image_url, product_url, sort_order')
        .eq('bundle_id', bundleId)
        .order('sort_order', { ascending: true });

      const parsedItems = (itemsData || []).map(i => ({ ...i, price_usd: Number(i.price_usd) }));
      setItems(parsedItems);
      setSelected(new Set(parsedItems.map(i => i.id)));
      setLoading(false);
    })();
  }, [bundleId]);

  function toggleItem(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === items.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map(i => i.id)));
    }
  }

  const selectedItems = items.filter(i => selected.has(i.id));
  const total = selectedItems.reduce((s, i) => s + i.price_usd, 0);

  // If user is already logged in, skip guest form and go to checkout directly
  async function addItemsAndCheckout() {
    setSubmitting(true);
    try {
      for (const item of selectedItems) {
        if (!item.product_url) continue;
        await supabase.functions.invoke('mobile-cart', {
          body: {
            action: 'add_item',
            product_url: item.product_url,
            title: item.title,
            image_url: item.image_url,
            quantity: 1,
          },
        });
      }
      navigate('/checkout');
    } catch {
      toast.error('Erreur lors de la préparation de la commande');
    }
    setSubmitting(false);
  }

  function handlePayClick() {
    if (selectedItems.length === 0) {
      toast.error('Sélectionnez au moins un produit');
      return;
    }
    if (user) {
      addItemsAndCheckout();
    } else {
      setShowCheckout(true);
    }
  }

  const handleGuestCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const autoPassword = crypto.randomUUID().slice(0, 16) + 'Aa1!';
      const result = await signUp(email.trim(), autoPassword, fullName.trim(), phone.trim(), {
        country: country || 'DR Congo',
        city: city.trim() || 'Not provided',
        address_line1: address.trim() || 'Not provided',
      });

      if (result?.error) {
        const msg = result.error.message || '';
        const errorCode = (result.error as any)?.code || '';
        if (
          errorCode === 'USER_EXISTS' ||
          msg.toLowerCase().includes('already registered') ||
          msg.toLowerCase().includes('already exists') ||
          msg.toLowerCase().includes('user already')
        ) {
          setError('Ce compte existe déjà. Connectez-vous ci-dessous.');
          setLoginEmail(email.trim());
          setMode('login');
          setSubmitting(false);
          return;
        }
        setError(msg || 'Échec de l\'inscription');
        setSubmitting(false);
        return;
      }
      // Registration succeeded → add items to cart and go to checkout
      await addItemsAndCheckout();
    } catch {
      setError('Erreur de connexion');
      setSubmitting(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const { error: signInError } = await signIn(loginEmail.trim(), password, true);
      if (signInError) {
        const msg = signInError?.message || '';
        if (msg.includes('Invalid login')) {
          setError('Email ou mot de passe incorrect');
        } else {
          setError('Erreur de connexion. Réessayez.');
        }
        setSubmitting(false);
        return;
      }
      // Login succeeded → add items and checkout
      await addItemsAndCheckout();
    } catch {
      setError('Erreur de connexion');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!bundle) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background gap-4">
        <Package className="w-16 h-16 text-muted-foreground/40" />
        <p className="text-lg font-medium">Ce pack n'est plus disponible</p>
        <Button onClick={() => navigate('/')}>Retour à l'accueil</Button>
      </div>
    );
  }

  const expired = bundle.expires_at && new Date(bundle.expires_at) < new Date();
  if (expired || !bundle.is_active) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background gap-4">
        <Package className="w-16 h-16 text-muted-foreground/40" />
        <p className="text-lg font-medium">Ce pack a expiré</p>
        <Button onClick={() => navigate('/')}>Retour à l'accueil</Button>
      </div>
    );
  }

  // ── Checkout form view ──
  if (showCheckout) {
    return (
      <>
        <Helmet>
          <title>{bundle.title} - Paiement</title>
        </Helmet>
        <div className="min-h-screen bg-black">
          {/* Header */}
          <div className="sticky top-0 z-10 bg-black/95 backdrop-blur border-b border-white/10 px-4 py-3">
            <div className="max-w-4xl mx-auto flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setShowCheckout(false)} className="gap-1 text-white/70 hover:text-white">
                <ArrowLeft className="w-4 h-4" /> Retour
              </Button>
              <span className="text-sm font-medium text-white">{bundle.title}</span>
              <div className="w-20" />
            </div>
          </div>

          <div className="pt-8 px-4 max-w-4xl mx-auto pb-12">
            <div className="flex flex-col lg:flex-row gap-8">
              {/* Product summary */}
              <div className="lg:w-1/2 space-y-4">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <ShoppingBag className="h-5 w-5 text-blue-400" />
                  Votre commande
                </h2>
                <div className="space-y-3">
                  {selectedItems.map((item) => (
                    <div key={item.id} className="flex gap-4 rounded-xl bg-white/5 border border-white/10 p-3">
                      {item.image_url ? (
                        <img src={item.image_url} alt="" className="w-24 h-24 rounded-lg object-contain bg-white flex-shrink-0" loading="lazy" />
                      ) : (
                        <div className="w-24 h-24 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                          <Package className="w-6 h-6 text-white/30" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white font-medium line-clamp-2">{item.title}</p>
                        <p className="text-xs text-white/50 mt-1">Quantité: 1</p>
                        <p className="text-base font-bold text-blue-400 mt-2">
                          {formatCurrency(item.price_usd, { currency: 'USD' })}
                        </p>
                        <span className="inline-block mt-1 text-[10px] text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
                          Livraison incluse
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between items-center pt-3 border-t border-white/10">
                  <span className="text-white/60 text-sm">Total</span>
                  <span className="text-white font-bold text-lg">
                    {formatCurrency(total, { currency: 'USD' })}
                  </span>
                </div>
              </div>

              {/* Checkout form */}
              <div className="lg:w-1/2">
                <div className="text-center mb-6">
                  <ShoppingBag className="h-10 w-10 text-blue-400 mx-auto mb-3" />
                  <h2 className="text-lg font-semibold text-white">
                    {mode === 'guest' ? 'Finaliser votre commande' : 'Se connecter'}
                  </h2>
                  <p className="text-sm text-white/50 mt-1">
                    {mode === 'guest' ? 'Entrez vos coordonnées pour continuer' : 'Connectez-vous à votre compte'}
                  </p>
                </div>

                {mode === 'guest' ? (
                  <form onSubmit={handleGuestCheckout} className="space-y-3">
                    <div>
                      <Label htmlFor="guest-name" className="text-white/70 text-sm">Nom complet *</Label>
                      <Input id="guest-name" type="text" autoComplete="name" required value={fullName} onChange={(e) => setFullName(e.target.value)} className="bg-white/10 border-white/20 text-white placeholder:text-white/30" placeholder="Jean Mukendi" />
                    </div>
                    <div>
                      <Label htmlFor="guest-email" className="text-white/70 text-sm">Email *</Label>
                      <Input id="guest-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="bg-white/10 border-white/20 text-white placeholder:text-white/30" placeholder="you@email.com" />
                    </div>
                    <div>
                      <Label htmlFor="guest-phone" className="text-white/70 text-sm">Téléphone *</Label>
                      <Input id="guest-phone" type="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} className="bg-white/10 border-white/20 text-white placeholder:text-white/30" placeholder="+243 ..." />
                    </div>
                    <div>
                      <Label htmlFor="guest-address" className="text-white/70 text-sm">Adresse *</Label>
                      <Input id="guest-address" type="text" autoComplete="street-address" required value={address} onChange={(e) => setAddress(e.target.value)} className="bg-white/10 border-white/20 text-white placeholder:text-white/30" placeholder="Avenue, numéro, quartier" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor="guest-city" className="text-white/70 text-sm">Ville *</Label>
                        <Input id="guest-city" type="text" autoComplete="address-level2" required value={city} onChange={(e) => setCity(e.target.value)} className="bg-white/10 border-white/20 text-white placeholder:text-white/30" placeholder="Kinshasa" />
                      </div>
                      <div>
                        <Label htmlFor="guest-country" className="text-white/70 text-sm">Pays</Label>
                        <Input id="guest-country" type="text" autoComplete="country-name" value={country} onChange={(e) => setCountry(e.target.value)} className="bg-white/10 border-white/20 text-white placeholder:text-white/30" placeholder="DR Congo" />
                      </div>
                    </div>

                    {error && <p className="text-sm text-red-400 text-center">{error}</p>}

                    <Button type="submit" disabled={submitting || !email || !fullName || !phone || !address || !city} className="w-full h-12 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full disabled:opacity-50 mt-2">
                      {submitting ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Traitement...</>
                      ) : 'Continuer vers le paiement'}
                    </Button>

                    <p className="text-xs text-white/40 text-center mt-3">
                      Vous avez déjà un compte ?{' '}
                      <button type="button" onClick={() => { setMode('login'); setError(null); }} className="text-blue-400 underline">
                        Se connecter
                      </button>
                    </p>
                  </form>
                ) : (
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                      <Label htmlFor="login-email" className="text-white/70 text-sm">Email</Label>
                      <Input id="login-email" type="email" autoComplete="email" required value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} className="bg-white/10 border-white/20 text-white placeholder:text-white/30" placeholder="you@email.com" />
                    </div>
                    <div>
                      <Label htmlFor="login-password" className="text-white/70 text-sm">Mot de passe</Label>
                      <Input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="bg-white/10 border-white/20 text-white placeholder:text-white/30" placeholder="••••••••" />
                    </div>

                    {error && <p className="text-sm text-red-400 text-center">{error}</p>}

                    <Button type="submit" disabled={submitting || !loginEmail || !password} className="w-full h-12 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full disabled:opacity-50">
                      {submitting ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Connexion...</>
                      ) : 'Se connecter et payer'}
                    </Button>

                    <p className="text-xs text-white/40 text-center mt-3">
                      Pas de compte ?{' '}
                      <button type="button" onClick={() => { setMode('guest'); setError(null); }} className="text-blue-400 underline">
                        Commander en tant qu'invité
                      </button>
                    </p>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── Product selection view ──
  return (
    <>
      <Helmet>
        <title>{bundle.title} - Pack Produits</title>
        <meta property="og:title" content={bundle.title} />
        <meta property="og:description" content={bundle.description || `${items.length} produits - $${total.toFixed(2)}`} />
        {items[0]?.image_url && <meta property="og:image" content={items[0].image_url} />}
      </Helmet>

      <div className="min-h-screen bg-background">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={() => navigate('/')} className="gap-1">
              <ArrowLeft className="w-4 h-4" /> Accueil
            </Button>
            <span className="text-sm font-medium">{bundle.title}</span>
            <div className="w-20" />
          </div>
        </div>

        <div className="max-w-2xl mx-auto p-4 pb-32">
          {/* Bundle info */}
          <div className="mb-6">
            <h1 className="text-2xl font-bold">{bundle.title}</h1>
            {bundle.description && <p className="text-muted-foreground mt-1">{bundle.description}</p>}
            <p className="text-sm text-muted-foreground mt-2">
              {items.length} produit{items.length > 1 ? 's' : ''} dans ce pack
            </p>
          </div>

          {/* Select all toggle */}
          <div className="flex items-center gap-2 mb-4 pb-3 border-b">
            <Checkbox
              checked={selected.size === items.length}
              onCheckedChange={toggleAll}
            />
            <span className="text-sm font-medium">
              {selected.size === items.length ? 'Tout désélectionner' : 'Tout sélectionner'}
            </span>
            <span className="text-xs text-muted-foreground ml-auto">
              {selected.size}/{items.length} sélectionné{selected.size > 1 ? 's' : ''}
            </span>
          </div>

          {/* Items */}
          <div className="space-y-3">
            {items.map(item => (
              <div
                key={item.id}
                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer ${
                  selected.has(item.id) ? 'border-primary/50 bg-primary/5' : 'border-border'
                }`}
                onClick={() => toggleItem(item.id)}
              >
                <Checkbox
                  checked={selected.has(item.id)}
                  onCheckedChange={() => toggleItem(item.id)}
                  onClick={e => e.stopPropagation()}
                />
                {item.image_url ? (
                  <img src={item.image_url} alt="" className="w-16 h-16 rounded-md object-cover shrink-0" />
                ) : (
                  <div className="w-16 h-16 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Package className="w-5 h-5 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm leading-tight line-clamp-2">{item.title}</p>
                  <p className="text-primary font-bold mt-1">${item.price_usd}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Sticky bottom bar */}
        <div className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur border-t px-4 py-3 z-20">
          <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground">{selected.size} produit{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}</p>
              <p className="text-xl font-bold">${total.toFixed(2)}</p>
            </div>
            <Button
              onClick={handlePayClick}
              disabled={submitting || selected.size === 0}
              size="lg"
              className="gap-2"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
              Payer
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
