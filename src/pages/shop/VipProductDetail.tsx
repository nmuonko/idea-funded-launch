import { localizeVip, vipPrefersFrench } from '@/lib/vipLocale';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { useShopCart } from '@/hooks/useShopCart';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Loader2, ShoppingBag, Check } from 'lucide-react';
import { VipPhotoGallery, type VipPhoto } from '@/components/VipPhotoGallery';
import { vipSizeLabel, type VipSizeDisplay } from '@/lib/vipSizes';

interface VipProduct {
  id: string;
  name_fr: string | null;
  description_fr: string | null;
  image_url: string;
  image_gallery?: VipPhoto[];
  gallery_product_id?: string | null;
  final_price: number | null;
  status: 'available' | 'unavailable';
  colors: string[];
  sizes: string[];
  vip_categories?: { name: string; name_fr: string | null } | null;
}

interface Variant {
  id: string;
  size: string | null;
  color: string | null;
  available: boolean;
}

export default function VipProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { addItem } = useShopCart();

  const [product, setProduct] = useState<VipProduct | null>(null);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [color, setColor] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [sizeDisplay, setSizeDisplay] = useState<VipSizeDisplay>('letters');
  const fr = vipPrefersFrench();
  const text = (en: string, french: string) => fr ? french : en;
  const category = product?.vip_categories?.name ?? '';
  const convertibleSizes = product?.sizes.some((s) => vipSizeLabel(s, category, 'letters') !== vipSizeLabel(s, category, 'numbers'));

  useEffect(() => {
    (async () => {
      const { data: p } = await supabase
        .from('vip_products')
        .select('id, name_fr, description_fr, name_en, description_en, image_url, image_gallery, gallery_product_id, final_price, status, colors, sizes, vip_categories(name, name_fr)')
        .eq('id', id)
        .in('status', ['available', 'unavailable'])
        .maybeSingle();
      if (!p) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      if (p.gallery_product_id) { navigate(`/vip/${p.gallery_product_id}`, { replace: true }); return; }
      setProduct(localizeVip(p as unknown as VipProduct));
      const { data: v } = await supabase
        .from('vip_product_variants')
        .select('id, size, color, available')
        .eq('product_id', id);
      setVariants((v as Variant[]) ?? []);
      setLoading(false);
    })();
  }, [id, navigate]);

  const photos = useMemo(() => product?.image_gallery?.length ? product.image_gallery : product ? [{ url: product.image_url }] : [], [product]);

  const soldOut = product?.status === 'unavailable';

  // A variant is purchasable only if a matching available variant row exists.
  const selectionAvailable = useMemo(() => {
    if (!product || soldOut) return false;
    if (!variants.length) return true; // no variant tracking → product-level availability
    return variants.some(
      (v) =>
        v.available &&
        (v.color === null || v.color === color) &&
        (v.size === null || v.size === size),
    );
  }, [variants, color, size, product, soldOut]);

  const needsColor = (product?.colors.length ?? 0) > 0 && !color;
  const needsSize = (product?.sizes.length ?? 0) > 0 && !size;
  const canBuy = !!product && !soldOut && selectionAvailable && !needsColor && !needsSize;

  const buyNow = async () => {
    if (!product || !canBuy) return;
    setAdding(true);
    try {
      const variantNote = [color, size ? vipSizeLabel(size, product.vip_categories?.name ?? '') : null].filter(Boolean).join(' · ');
      await addItem({
        productId: `vip_${product.id}`,
        provider: 'vip',
        title: variantNote ? `${product.name_fr} (${variantNote})` : (product.name_fr ?? 'Article VIP'),
        imageUrl: photos.find((p) => p.colors?.includes(color ?? ''))?.url ?? product.image_url,
        priceUsd: product.final_price ?? 0,
        quantity: 1,
        productUrl: `https://afrishop-usa.com/vip/${product.id}`,
        isFixedPrice: true,
      });
      navigate('/cart');
    } catch (e: any) {
      toast({ title: text('Error', 'Erreur'), description: e.message, variant: 'destructive' });
      setAdding(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (notFound || !product) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-lg font-medium">{text('Product not found', 'Article introuvable')}</p>
        <Button asChild variant="outline"><Link to="/vip">{text('Back to VIP collection', 'Retour à la collection VIP')}</Link></Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-vip">
      <header className="border-b bg-background/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/vip')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> {text('VIP collection', 'Collection VIP')}
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6">
        <div className="grid md:grid-cols-2 gap-6">
          <VipPhotoGallery photos={photos} title={product.name_fr ?? 'VIP'} selectedColor={color} />

          <div className="space-y-5">
            <div>
              <h1 className="text-2xl font-semibold leading-tight mt-1">{product.name_fr}</h1>
              <p className="text-3xl font-bold text-vip-gold mt-2">
                ${product.final_price?.toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground">{text('Final price, all included', 'Prix final, tout inclus')}</p>
            </div>

            {product.description_fr && (
              <p className="text-sm text-muted-foreground leading-relaxed">{product.description_fr}</p>
            )}

            {product.colors.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">{text('Color', 'Couleur')} {color && <span className="text-muted-foreground">— {color}</span>}</p>
                <div className="flex flex-wrap gap-1.5">
                  {product.colors.map((c) => {
                    const hasAvailable = !variants.length || variants.some((v) => v.available && (v.color === null || v.color === c));
                    return (
                      <Button variant="outline" size="sm" aria-pressed={color === c}
                        key={c}
                        disabled={!hasAvailable}
                        onClick={() => setColor(c)}
                        className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                          color === c ? 'bg-primary text-primary-foreground' : hasAvailable ? 'hover:bg-muted' : 'opacity-40 line-through cursor-not-allowed'
                        }`}
                      >
                        {c}
                      </Button>
                    );
                  })}
                </div>
              </div>
            )}

            {product.sizes.length > 0 && (
              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-sm font-medium">{text('Size', 'Taille')}{convertibleSizes && <span className="text-muted-foreground"> · {sizeDisplay === 'letters' ? text('US letters', 'Lettres US') : text('Numbers', 'Numéros')}</span>}</p>
                  {convertibleSizes && <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" aria-label={text('Switch size format', 'Changer le format des tailles')} aria-pressed={sizeDisplay === 'numbers'} onClick={() => setSizeDisplay(sizeDisplay === 'letters' ? 'numbers' : 'letters')}>
                    {sizeDisplay === 'letters' ? text('Show numbers', 'Voir les numéros') : text('Show US letters', 'Voir les lettres US')}
                  </Button>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {product.sizes.map((s) => {
                    const hasAvailable = !variants.length || variants.some(
                      (v) => v.available && (v.size === null || v.size === s) && (v.color === null || v.color === color),
                    );
                    return (
                      <Button variant="outline" size="sm" aria-pressed={size === s}
                        key={s}
                        disabled={!hasAvailable}
                        onClick={() => setSize(s)}
                        className={`px-3 py-1.5 text-sm rounded-md border transition-colors ${
                          size === s ? 'bg-primary text-primary-foreground' : hasAvailable ? 'hover:bg-muted' : 'opacity-40 line-through cursor-not-allowed'
                        }`}
                      >
                        {vipSizeLabel(s, category, sizeDisplay)}
                      </Button>
                    );
                  })}
                </div>
                {convertibleSizes && <p className="mt-2 text-xs text-muted-foreground">{sizeDisplay === 'letters' ? text('Approximate US equivalents. Fit may vary.', 'Équivalences US approximatives. La coupe peut varier.') : text('European supplier sizes, not US numeric sizes.', 'Tailles européennes du fournisseur, pas les numéros US.')}</p>}
              </div>
            )}

            <div className="pt-2">
              {soldOut ? (
                <Button size="lg" className="w-full" disabled>{text('Sold out', 'Rupture de stock')}</Button>
              ) : !selectionAvailable && !needsColor && !needsSize ? (
                <Button size="lg" className="w-full" disabled>{text('This combination is sold out', 'Cette combinaison est épuisée')}</Button>
              ) : (
                <Button size="lg" className="w-full" onClick={buyNow} disabled={!canBuy || adding}>
                  {adding ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShoppingBag className="h-4 w-4 mr-2" />}
                  {text('Buy now', 'Acheter maintenant')}
                </Button>
              )}
              {canBuy && (
                <p className="text-xs text-primary flex items-center gap-1 mt-2">
                  <Check className="h-3 w-3" /> {text('Available', 'Disponible')}
                </p>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
