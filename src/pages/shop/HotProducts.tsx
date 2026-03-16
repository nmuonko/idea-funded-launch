import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Flame } from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { ShopFooter } from '@/components/shop/ShopFooter';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { formatCurrency } from '@/lib/formatCurrency';
import { useLanguage } from '@/contexts/LanguageContext';

interface HotProduct {
  title: string;
  image_url: string;
  total_price_usd: number;
  provider: string;
  provider_product_id: string;
  price_usd?: number;
  markup_usd?: number;
  shipping_usd?: number;
}

interface Campaign {
  id: string;
  title: string;
  status: string;
  sent_at: string;
  products: HotProduct[];
}

export default function HotProducts() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchCampaign() {
      try {
        const { data, error: fetchError } = await supabase
          .from('hot_product_campaigns')
          .select('id, title, status, sent_at, products')
          .eq('status', 'sent')
          .order('sent_at', { ascending: false })
          .limit(1)
          .single();

        if (fetchError) throw fetchError;
        if (data) {
          setCampaign({
            ...data,
            products: (data.products as unknown as HotProduct[]) || [],
          });
        }
      } catch (err: any) {
        console.error('Failed to fetch hot products campaign:', err);
        setError(err.message || 'Failed to load hot products');
      } finally {
        setLoading(false);
      }
    }
    fetchCampaign();
  }, []);

  const products = campaign?.products?.slice(0, 10) || [];
  const locale = (language === 'fr' || language === 'ln') ? 'fr' : 'en';

  return (
    <div className="min-h-screen bg-black pb-safe-nav">
      <ShopHeader />

      <main className="pt-20 px-3 sm:px-4 pb-24">
        <div className="mx-auto max-w-5xl">
          {/* Back button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/')}
            className="text-white/70 hover:text-white mb-4"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            {locale === 'fr' ? 'Retour à l\'accueil' : 'Back to Homepage'}
          </Button>

          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <Flame className="w-7 h-7 text-orange-500" />
            <h1 className="text-2xl sm:text-3xl font-bold text-white">
              {locale === 'fr' ? 'Produits Populaires' : 'Hot Products'}
            </h1>
          </div>

          {campaign?.title && (
            <p className="text-white/60 text-sm mb-6">{campaign.title}</p>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-white/50 animate-spin" />
            </div>
          )}

          {/* Error */}
          {error && !loading && (
            <div className="text-center py-20">
              <p className="text-white/50 mb-4">
                {locale === 'fr'
                  ? 'Aucune campagne disponible pour le moment.'
                  : 'No hot products available right now.'}
              </p>
              <Button onClick={() => navigate('/')} variant="outline" className="border-white/20 text-white">
                {locale === 'fr' ? 'Voir la boutique' : 'Browse Shop'}
              </Button>
            </div>
          )}

          {/* Products Grid */}
          {!loading && !error && products.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
              {products.map((product, index) => (
                <motion.div
                  key={`${product.provider_product_id}-${index}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="bg-white/5 border border-white/10 rounded-xl overflow-hidden hover:border-orange-500/40 transition-colors group cursor-pointer"
                  onClick={() => navigate(`/product/${product.provider}/${product.provider_product_id}`)}
                >
                  {/* Image */}
                  <div className="aspect-square bg-white/5 overflow-hidden">
                    <img
                      src={product.image_url}
                      alt={product.title}
                      className="w-full h-full object-contain p-2 group-hover:scale-105 transition-transform"
                      loading="lazy"
                    />
                  </div>

                  {/* Info */}
                  <div className="p-3">
                    <p className="text-white text-xs sm:text-sm font-medium line-clamp-2 mb-2 min-h-[2.5rem]">
                      {product.title}
                    </p>
                    <p className="text-orange-400 font-bold text-sm sm:text-base">
                      {formatCurrency(product.total_price_usd, { locale: locale as any })}
                    </p>
                    <p className="text-white/40 text-[10px] mt-1">
                      {locale === 'fr' ? 'Livraison incluse' : 'Shipping included'}
                    </p>
                    <Button
                      size="sm"
                      className="w-full mt-3 bg-orange-500 hover:bg-orange-600 text-white text-xs h-8"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/product/${product.provider}/${product.provider_product_id}`);
                      }}
                    >
                      {locale === 'fr' ? 'Commander' : 'Order'}
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && products.length === 0 && (
            <div className="text-center py-20">
              <p className="text-white/50">
                {locale === 'fr'
                  ? 'Aucun produit populaire pour le moment.'
                  : 'No hot products available right now.'}
              </p>
            </div>
          )}
        </div>
      </main>

      <ShopFooter />
      <BottomNavigation />
    </div>
  );
}
