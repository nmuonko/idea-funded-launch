import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/formatCurrency';
import { Loader2, ShoppingCart, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ProductImageViewer } from '@/components/shop/ProductImageViewer';

interface ShareProduct {
  id: string;
  title: string;
  image_url: string;
  total_price_usd: number;
  description_fr: string | null;
  gallery_images: string[] | null;
  provider: string;
  provider_product_id: string;
  product_url: string | null;
  is_active: boolean;
}

export default function HotProductShare() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<ShareProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeImage, setActiveImage] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data } = await (supabase
        .from('hot_products_showcase')
        .select('id, title, image_url, total_price_usd, description_fr, gallery_images, provider, provider_product_id, product_url, is_active') as any)
        .eq('id', id)
        .single();
      if (data) setProduct(data as ShareProduct);
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <Loader2 className="w-8 h-8 text-white/50 animate-spin" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white gap-4">
        <p>Produit non trouvé</p>
        <Button onClick={() => navigate('/')}>Retour</Button>
      </div>
    );
  }

  const description = product.description_fr || product.title;
  const priceText = `$${product.total_price_usd}`;
  const ogTitle = `${product.title} - ${priceText}`;
  const ogDesc = description.slice(0, 155);
  const checkoutUrl = `${window.location.origin}/checkout?hp=${product.id}`;
  const allImages = [product.image_url, ...(product.gallery_images || [])].filter(Boolean);
  // Deduplicate
  const uniqueImages = [...new Set(allImages)];

  return (
    <>
      <Helmet>
        <title>{ogTitle}</title>
        <meta property="og:title" content={ogTitle} />
        <meta property="og:description" content={ogDesc} />
        <meta property="og:image" content={uniqueImages[0]} />
        <meta property="og:type" content="product" />
        <meta property="og:url" content={window.location.href} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={ogTitle} />
        <meta name="twitter:description" content={ogDesc} />
        <meta name="twitter:image" content={uniqueImages[0]} />
      </Helmet>

      <div className="min-h-screen bg-black text-white">
        <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
          {/* Main Image with navigation */}
          {uniqueImages.length > 0 && (
            <div className="space-y-3">
              <div className="relative bg-white rounded-2xl overflow-hidden cursor-pointer" onClick={() => setViewerOpen(true)}>
                <img
                  src={uniqueImages[activeImage]}
                  alt={product.title}
                  className="w-full object-contain max-h-[420px]"
                />
                {uniqueImages.length > 1 && (
                  <>
                    <button
                      onClick={() => setActiveImage(i => (i - 1 + uniqueImages.length) % uniqueImages.length)}
                      className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 rounded-full p-1.5 transition-colors"
                    >
                      <ChevronLeft className="w-5 h-5 text-white" />
                    </button>
                    <button
                      onClick={() => setActiveImage(i => (i + 1) % uniqueImages.length)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 rounded-full p-1.5 transition-colors"
                    >
                      <ChevronRight className="w-5 h-5 text-white" />
                    </button>
                    {/* Counter */}
                    <div className="absolute bottom-2 right-2 bg-black/60 rounded-full px-2.5 py-0.5 text-xs font-medium">
                      {activeImage + 1}/{uniqueImages.length}
                    </div>
                  </>
                )}
              </div>

              {/* Thumbnail strip */}
              {uniqueImages.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {uniqueImages.map((img, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveImage(i)}
                      className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                        i === activeImage ? 'border-orange-400 ring-1 ring-orange-400/50' : 'border-white/20 opacity-60 hover:opacity-100'
                      }`}
                    >
                      <img src={img} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Product Info */}
          <div className="space-y-3">
            <h1 className="text-xl font-bold">{product.title}</h1>
            {product.description_fr && (
              <p className="text-white/70 text-sm leading-relaxed">{product.description_fr}</p>
            )}
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-orange-400">
                {formatCurrency(product.total_price_usd, { locale: 'fr' as any })}
              </span>
              <span className="text-sm text-emerald-400">✓ Livraison incluse en RDC</span>
            </div>
          </div>

          {/* CTA */}
          <Button
            size="lg"
            className="w-full h-14 text-lg font-bold bg-emerald-600 hover:bg-emerald-700"
            onClick={() => navigate(checkoutUrl.replace(window.location.origin, ''))}
          >
            <ShoppingCart className="w-5 h-5 mr-2" />
            Commander maintenant
          </Button>

          <p className="text-center text-white/40 text-xs">
            AfriShop · Livraison depuis les USA vers la RDC
          </p>
        </div>
      </div>

      {viewerOpen && uniqueImages.length > 0 && (
        <ProductImageViewer
          images={uniqueImages}
          currentIndex={activeImage}
          onClose={() => setViewerOpen(false)}
          onIndexChange={setActiveImage}
        />
      )}
    </>
  );
}
