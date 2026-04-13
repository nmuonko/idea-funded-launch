import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Flame, Loader2 } from 'lucide-react';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { useShopCart } from '@/hooks/useShopCart';
import { toast } from 'sonner';

interface HotProduct {
  id: string;
  title: string;
  image_url: string;
  total_price_usd: number;
  provider: string;
  provider_product_id?: string;
  product_url?: string;
}

const buildHotProductUrl = (product: HotProduct) => {
  if (product.product_url) return product.product_url;

  const provider = (product.provider || '').toLowerCase();
  const rawId = product.provider_product_id?.trim();
  if (!rawId) return null;

  if (provider === 'ebay') {
    const ebayItemId = rawId.startsWith('v1|') ? rawId.split('|')[1] || rawId : rawId;
    return `https://www.ebay.com/itm/${ebayItemId}`;
  }

  let cleanId = rawId;
  if (cleanId.toLowerCase().startsWith('amazon_')) cleanId = cleanId.slice(7);
  if (cleanId.toLowerCase().startsWith('rainforest_')) cleanId = cleanId.slice(11);

  return `https://www.amazon.com/dp/${cleanId.toUpperCase()}`;
};

export default function HotProductBuy() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { language } = useLanguage();
  const { addItem, items, initialized } = useShopCart();

  const [product, setProduct] = useState<HotProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [preparingCheckout, setPreparingCheckout] = useState(false);
  const attemptedRef = useRef(false);

  const locale = language === 'fr' || language === 'ln' ? 'fr' : 'en';

  useEffect(() => {
    if (!id) return;

    const loadProduct = async () => {
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
          return;
        }

        setProduct(data as HotProduct);
      } catch (error) {
        console.error('Failed to fetch hot product:', error);
        setProduct(null);
      } finally {
        setLoading(false);
      }
    };

    void loadProduct();
  }, [id]);

  const productUrl = useMemo(() => (product ? buildHotProductUrl(product) : null), [product]);

  const alreadyInCart = useMemo(() => {
    if (!product) return false;

    const providerProductId = product.provider_product_id?.trim();
    const normalizedProductUrl = productUrl?.trim().toLowerCase();

    return items.some((item) => {
      const itemUrl = item.productUrl?.trim().toLowerCase();
      return (normalizedProductUrl && itemUrl === normalizedProductUrl) || (!!providerProductId && item.productId?.trim() === providerProductId);
    });
  }, [items, product, productUrl]);

  const prepareCheckout = useCallback(async () => {
    if (!product || !productUrl || preparingCheckout) return;

    setPreparingCheckout(true);

    try {
      if (!alreadyInCart) {
        await addItem({
          productId: product.provider_product_id || productUrl,
          provider: product.provider,
          title: product.title,
          imageUrl: product.image_url,
          priceUsd: product.total_price_usd,
          quantity: 1,
          productUrl,
          isFixedPrice: true,
        });
      }

      navigate('/checkout', { replace: true });
    } catch (error) {
      console.error('Failed to prepare hot product checkout:', error);
      setPreparingCheckout(false);
      attemptedRef.current = false;
      toast.error(locale === 'fr' ? 'Impossible d’ouvrir le paiement' : 'Unable to open checkout');
    }
  }, [addItem, alreadyInCart, locale, navigate, preparingCheckout, product, productUrl]);

  useEffect(() => {
    if (!product || !productUrl || !initialized || attemptedRef.current) return;
    attemptedRef.current = true;
    void prepareCheckout();
  }, [initialized, prepareCheckout, product, productUrl]);

  if (loading || !initialized || preparingCheckout) {
    return (
      <div className="min-h-screen bg-black">
        <ShopHeader />
        <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
          <Loader2 className="mb-4 h-8 w-8 animate-spin text-white/60" />
          <p className="text-sm text-white/60">
            {locale === 'fr' ? 'Préparation de votre page de paiement…' : 'Preparing your checkout page...'}
          </p>
        </div>
        <BottomNavigation />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-black">
        <ShopHeader />
        <div className="pt-24 text-center">
          <Flame className="mx-auto mb-4 h-12 w-12 text-white/20" />
          <p className="text-white/50">
            {locale === 'fr' ? 'Produit introuvable.' : 'Product not found.'}
          </p>
          <Button variant="ghost" className="mt-4 text-white/70" onClick={() => navigate('/hot-products')}>
            {locale === 'fr' ? 'Voir tous les produits' : 'View all products'}
          </Button>
        </div>
        <BottomNavigation />
      </div>
    );
  }

  if (!productUrl) {
    return (
      <div className="min-h-screen bg-black">
        <ShopHeader />
        <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
          <p className="mb-4 text-white/60">
            {locale === 'fr'
              ? 'Ce produit ne peut pas être envoyé au paiement pour le moment.'
              : 'This product cannot be sent to checkout right now.'}
          </p>
          <Button onClick={() => navigate('/hot-products')}>
            {locale === 'fr' ? 'Retour aux hot products' : 'Back to hot products'}
          </Button>
        </div>
        <BottomNavigation />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      <ShopHeader />
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 text-center">
        <p className="mb-4 text-white/60">
          {locale === 'fr' ? 'Redirection vers le paiement…' : 'Redirecting to checkout...'}
        </p>
        <Button onClick={() => void prepareCheckout()}>
          {locale === 'fr' ? 'Continuer vers le paiement' : 'Continue to checkout'}
        </Button>
      </div>
      <BottomNavigation />
    </div>
  );
}
