import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, ShoppingCart, Package, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

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
  const { user } = useAuth();
  const [bundle, setBundle] = useState<BundleData | null>(null);
  const [items, setItems] = useState<BundleItemData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [addingToCart, setAddingToCart] = useState(false);

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

  async function handleAddToCart() {
    if (selectedItems.length === 0) {
      toast.error('Sélectionnez au moins un produit');
      return;
    }

    if (!user) {
      navigate('/shop-auth?redirect=' + encodeURIComponent(window.location.pathname));
      return;
    }

    setAddingToCart(true);
    try {
      // Add each selected item to cart via the standard cart flow
      // Each item goes through weight-based shipping calculation in mobile-cart
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
      toast.success(`${selectedItems.length} produit(s) ajouté(s) au panier`);
      navigate('/cart');
    } catch {
      toast.error('Erreur lors de l\'ajout au panier');
    }
    setAddingToCart(false);
  }

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
              onClick={handleAddToCart}
              disabled={addingToCart || selected.size === 0}
              size="lg"
              className="gap-2"
            >
              {addingToCart ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />}
              Ajouter au panier
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
