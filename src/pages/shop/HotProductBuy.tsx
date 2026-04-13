import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, Flame, Zap, ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { CheckoutInlineLogin } from '@/components/shop/CheckoutInlineLogin';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/formatCurrency';
import { useLanguage } from '@/contexts/LanguageContext';
import { useShopCart } from '@/hooks/useShopCart';
import { useAuth } from '@/contexts/AuthContext';
import { translations } from '@/lib/i18n/translations';
import { toast } from 'sonner';

interface HotProduct {
  id: string;
  title: string;
  image_url: string;
  total_price_usd: number;
  provider: string;
  provider_product_id: string;
  price_usd?: number;
  markup_usd?: number;
  shipping_usd?: number;
  product_url?: string;
  description?: string;
}

export default function HotProductBuy() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const { addItem } = useShopCart();
  const { session, isAuthReady } = useAuth();
  const t = translations[language] || translations.en;
  const shop = (t.shop || {}) as any;

  const [product, setProduct] = useState<HotProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const didAutoAddRef = useRef(false);

  const locale = (language === 'fr' || language === 'ln') ? 'fr' : 'en';

  // Fetch the single hot product
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('hot_products_showcase')
          .select('*')
          .eq('id', id)
          .eq('is_active', true)
          .single();

        if (error || !data) {
          console.error('Hot product not found:', error);
          setProduct(null);
        } else {
          setProduct(data as any);
        }
      } catch (err) {
        console.error('Failed to fetch hot product:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Once user is authenticated (after guest signup), auto-add to cart and go to checkout
  useEffect(() => {
    if (!session || !product || didAutoAddRef.current || !isAuthReady) return;
    didAutoAddRef.current = true;
    handleBuyNow();
  }, [session, product, isAuthReady]);

  const handleBuyNow = async () => {
    if (!product || processing) return;

    if (!session) {
      // Will show guest checkout form — no redirect needed
      return;
    }

    setProcessing(true);
    try {
      await addItem({
        productId: product.provider_product_id,
        provider: product.provider,
        title: product.title,
        imageUrl: product.image_url,
        priceUsd: product.total_price_usd,
        quantity: 1,
        productUrl: product.product_url || `https://afrishop-usa.com/product/${product.provider}/${product.provider_product_id}`,
        isFixedPrice: true,
      });

      navigate('/checkout');
    } catch {
      toast.error(locale === 'fr' ? 'Erreur, réessayez' : 'Error, please retry');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-white/50 animate-spin" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-black">
        <ShopHeader />
        <div className="pt-24 text-center">
          <Flame className="w-12 h-12 text-white/20 mx-auto mb-4" />
          <p className="text-white/50">
            {locale === 'fr' ? 'Produit introuvable.' : 'Product not found.'}
          </p>
          <Button variant="ghost" className="text-white/70 mt-4" onClick={() => navigate('/hot-products')}>
            {locale === 'fr' ? 'Voir tous les produits' : 'View all products'}
          </Button>
        </div>
        <BottomNavigation />
      </div>
    );
  }

  // If not logged in, show the product + guest checkout form
  if (!session) {
    return (
      <div className="min-h-screen bg-black pb-safe-nav">
        <ShopHeader />
        <main className="pt-20 px-3 sm:px-4 pb-24">
          <div className="mx-auto max-w-lg space-y-6">
            {/* Product Card */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-[#1a1d23] border border-white/[0.08] rounded-xl overflow-hidden"
            >
              <div className="aspect-square bg-white overflow-hidden max-h-72">
                <img
                  src={product.image_url}
                  alt={product.title}
                  className="w-full h-full object-contain p-4"
                />
              </div>
              <div className="p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500 text-white text-[10px] font-bold uppercase tracking-wide">
                    <Flame className="w-3 h-3" /> Deal
                  </span>
                </div>
                <h1 className="text-white text-lg font-bold leading-tight">{product.title}</h1>
                <p className="text-orange-400 font-extrabold text-2xl">
                  {formatCurrency(product.total_price_usd, { locale: locale as any })}
                </p>
                <p className="text-emerald-400/80 text-xs font-medium flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  {locale === 'fr' ? 'Prix tout inclus · Livraison en RDC incluse' : 'All-inclusive · Shipping to DRC included'}
                </p>
              </div>
            </motion.div>

            {/* Guest Checkout Form */}
            <div className="bg-[#1a1d23] border border-white/[0.08] rounded-xl p-4">
              <h2 className="text-white font-bold text-base mb-1">
                {locale === 'fr' ? 'Finalisez votre commande' : 'Complete your order'}
              </h2>
              <p className="text-white/50 text-sm mb-4">
                {locale === 'fr' ? 'Entrez vos informations pour commander' : 'Enter your details to place your order'}
              </p>
              <CheckoutInlineLogin language={language} shop={shop} />
            </div>
          </div>
        </main>
        <BottomNavigation />
      </div>
    );
  }

  // Logged in — show product + buy button (auto-buy already triggered above)
  return (
    <div className="min-h-screen bg-black pb-safe-nav">
      <ShopHeader />
      <main className="pt-20 px-3 sm:px-4 pb-24">
        <div className="mx-auto max-w-lg space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-[#1a1d23] border border-white/[0.08] rounded-xl overflow-hidden"
          >
            <div className="aspect-square bg-white overflow-hidden max-h-72">
              <img
                src={product.image_url}
                alt={product.title}
                className="w-full h-full object-contain p-4"
              />
            </div>
            <div className="p-4 space-y-3">
              <h1 className="text-white text-lg font-bold">{product.title}</h1>
              <p className="text-orange-400 font-extrabold text-2xl">
                {formatCurrency(product.total_price_usd, { locale: locale as any })}
              </p>
              <p className="text-emerald-400/80 text-xs font-medium">
                ✓ {locale === 'fr' ? 'Livraison incluse' : 'Shipping included'}
              </p>
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                onClick={handleBuyNow}
                disabled={processing}
              >
                {processing ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {locale === 'fr' ? 'Chargement...' : 'Loading...'}</>
                ) : (
                  <><Zap className="w-4 h-4 mr-2" /> {locale === 'fr' ? 'Payer maintenant' : 'Pay Now'}</>
                )}
              </Button>
            </div>
          </motion.div>
        </div>
      </main>
      <BottomNavigation />
    </div>
  );
}
