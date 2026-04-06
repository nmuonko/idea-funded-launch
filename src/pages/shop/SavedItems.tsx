import { Link } from 'react-router-dom';
import { Heart, ShoppingCart, ArrowLeft, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { Button } from '@/components/ui/button';
import { useShopCart } from '@/contexts/ShopCartContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

export default function SavedItems() {
  const { savedItems, removeFromSaved, addItem, removeItem, exchangeRate } = useShopCart();
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = t.shop as any;

  const handleMoveToCart = async (item: typeof savedItems[0]) => {
    await addItem({
      productId: item.productId,
      provider: item.provider,
      title: item.title,
      imageUrl: item.imageUrl,
      priceUsd: item.priceUsd,
      quantity: 1,
      productUrl: item.productUrl,
    });
    removeFromSaved(item.id);
  };

  

  return (
    <div className="min-h-screen bg-black pb-safe-nav">
      <ShopHeader />
      
      <main className="pt-20 px-4">
        <div className="container mx-auto max-w-4xl">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <Link to="/">
              <Button variant="ghost" size="icon" className="text-white hover:bg-white/10">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Heart className="h-6 w-6 text-red-400" />
              {shop?.savedTitle || 'Saved Items'}
            </h1>
          </div>

          {savedItems.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-center py-20"
            >
              <Heart className="h-16 w-16 text-white/20 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-white mb-2">
                {shop?.noSavedItems || 'No saved items yet'}
              </h2>
              <p className="text-white/60 mb-6">
                {shop?.savedItemsDescription || 'Save items you love to find them easily later'}
              </p>
              <Link to="/">
                <Button className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full px-6">
                  {shop?.startShopping || 'Start Shopping'}
                </Button>
              </Link>
            </motion.div>
          ) : (
            <div className="space-y-4">
              {savedItems.map((item, index) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="bg-white/5 border border-white/10 rounded-xl p-4 flex gap-4"
                >
                  {/* Product Image */}
                  <Link 
                    to={`/product/${item.provider}/${encodeURIComponent(item.productId)}`}
                    className="w-24 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-white/5"
                  >
                    <img
                      src={sanitizeCartImage(item.imageUrl)}
                      alt={item.title}
                      className="w-full h-full object-contain p-2"
                    />
                  </Link>

                  {/* Product Info */}
                  <div className="flex-1 min-w-0">
                    <Link 
                      to={`/product/${item.provider}/${encodeURIComponent(item.productId)}`}
                      className="text-sm font-medium text-white line-clamp-2 hover:text-blue-400 transition-colors"
                    >
                      {item.title}
                    </Link>
                    
                    <div className="mt-2">
                      <span className="text-lg font-bold text-white">
                        ${item.priceUsd.toFixed(2)}
                      </span>
                      <span className="text-xs text-white/50 block">
                        ≈ CDF {(item.priceUsd * exchangeRate).toLocaleString()}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 mt-3">
                      <Button
                        size="sm"
                        onClick={() => handleMoveToCart(item)}
                        className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full text-xs h-8"
                      >
                        <ShoppingCart className="h-3 w-3 mr-1" />
                        {shop?.moveToCart || 'Move to Cart'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeFromSaved(item.id)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded-full h-8"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </main>

      <BottomNavigation />
    </div>
  );
}
