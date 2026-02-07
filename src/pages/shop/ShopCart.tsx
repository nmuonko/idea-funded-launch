import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShoppingBag, Trash2, Plus, Minus, Car, Loader2, FileText } from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { PriceBreakdown } from '@/components/shop/PriceBreakdown';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useShopCart } from '@/contexts/ShopCartContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export default function ShopCart() {
  const { items, totalUsd, loading, updateQuantity, removeItem, clearCart, restoreFromPendingCheckout, hasVehicleItems, vehicleQuoteStatus, canProceedToPayment, syncCart } = useShopCart();
  const { user } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();
  const t = translations[language] || translations.en;
  const shop = (t.shop || {}) as any;
  const [requestingQuote, setRequestingQuote] = useState(false);

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);

  // Try to restore cart from pending checkout if empty on mount
  useEffect(() => {
    if (items.length === 0) {
      const restored = restoreFromPendingCheckout();
      if (restored) {
        console.log('[CART] Restored from pending checkout on cart page');
      }
    }
  }, []);

  const requestVehicleQuote = async () => {
    setRequestingQuote(true);
    try {
      const { data, error } = await supabase.functions.invoke('mobile-request-quote');
      if (error) throw error;
      toast({
        title: language === 'fr' ? 'Devis demandé !' : 'Quote Requested!',
        description: language === 'fr' 
          ? 'Nous vous notifierons par email quand votre devis sera prêt.'
          : "We'll notify you by email when your shipping quote is ready.",
      });
      await syncCart();
    } catch (err: any) {
      console.error('[CART] Quote request failed:', err);
      toast({
        title: language === 'fr' ? 'Erreur' : 'Error',
        description: err.message || 'Failed to request quote',
        variant: 'destructive',
      });
    } finally {
      setRequestingQuote(false);
    }
  };

  return (
    <div className="min-h-screen bg-black">
      <ShopHeader />

      <main className="pt-24 px-4 pb-20">
        <div className="container mx-auto max-w-4xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <Link 
                to="/" 
                className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-2 transition-colors"
              >
                <ArrowLeft className="h-4 w-4" />
                {shop.continueShopping || 'Continue Shopping'}
              </Link>
              <h1 className="text-2xl font-bold text-white">{shop.yourCart || 'Your Cart'}</h1>
              {items.length > 0 && (
                <p className="text-white/60">
                  {totalQuantity} {totalQuantity !== 1 ? (shop.items || 'items') : (shop.item || 'item')}
                </p>
              )}
            </div>

            {items.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => clearCart()}
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {shop.clearCart || 'Clear Cart'}
              </Button>
            )}
          </div>

          {items.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="min-h-[60vh] flex flex-col items-center justify-center text-center"
            >
              <ShoppingBag className="h-20 w-20 text-white/20 mx-auto mb-6" />
              <h2 className="text-xl font-semibold text-white mb-2">{shop.emptyCart || 'Your cart is empty'}</h2>
              <p className="text-white/60 mb-8">
                {shop.emptyCartMessage || "Looks like you haven't added any products yet"}
              </p>
              <Link to="/">
                <Button className="bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full px-8">
                  {shop.startShopping || 'Start Shopping'}
                </Button>
              </Link>
            </motion.div>
          ) : (
            <div className="grid lg:grid-cols-3 gap-8">
              {/* Cart Items */}
              <div className="lg:col-span-2 space-y-4">
                {items.map((item, index) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="flex gap-4 p-4 bg-white/5 rounded-2xl border border-white/10"
                  >
                    {/* Image */}
                    <Link 
                      to={`/product/${item.provider}/${encodeURIComponent(item.productId)}`}
                      className="w-24 h-24 rounded-xl overflow-hidden bg-white/5 flex-shrink-0"
                    >
                      <img
                        src={item.imageUrl || '/placeholder.svg'}
                        alt={item.title}
                        className="w-full h-full object-contain p-2"
                      />
                    </Link>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <Link 
                        to={`/product/${item.provider}/${encodeURIComponent(item.productId)}`}
                        className="text-white hover:text-blue-400 transition-colors"
                      >
                        <h3 className="font-medium line-clamp-2 mb-1">
                          {item.title}
                        </h3>
                      </Link>
                      <p className="text-sm text-white/60 capitalize mb-2">
                        from {item.provider}
                      </p>
                      {item.isVehicle && (
                        <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 mb-2">
                          <Car className="h-3 w-3 mr-1" />
                          {language === 'fr' ? 'Véhicule — Devis requis' : 'Vehicle — Quote Required'}
                        </Badge>
                      )}
                      <p className="text-lg font-bold text-white">
                        ${item.priceUsd.toFixed(2)}
                      </p>
                    </div>

                    {/* Quantity & Remove */}
                    <div className="flex flex-col items-end justify-between">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(item.id)}
                        className="h-8 w-8 p-0 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-full"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>

                      <div className="flex items-center gap-2 bg-white/5 rounded-full p-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="h-7 w-7 p-0 text-white/60 hover:text-white hover:bg-white/10 rounded-full"
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="text-white w-6 text-center text-sm">
                          {item.quantity}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          className="h-7 w-7 p-0 text-white/60 hover:text-white hover:bg-white/10 rounded-full"
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* Order Summary */}
              <div className="lg:col-span-1">
                <div className="sticky top-24 bg-white/5 rounded-2xl border border-white/10 p-6">
                  <h2 className="text-lg font-semibold text-white mb-4">{shop.orderSummary || 'Order Summary'}</h2>
                  
                  <PriceBreakdown 
                    itemPriceUsd={totalUsd} 
                    showDetails={true}
                  />

                  <div className="mt-6 space-y-3">
                    {/* Vehicle quote pending - show request quote button */}
                    {hasVehicleItems && vehicleQuoteStatus !== 'quoted' && user ? (
                      vehicleQuoteStatus === 'pending' ? (
                        <div className="text-center space-y-2">
                          <div className="flex items-center justify-center gap-2 text-amber-400 text-sm">
                            <FileText className="h-4 w-4" />
                            {language === 'fr' ? 'Devis en attente — Vous serez notifié par email' : 'Quote pending — You\'ll be notified by email'}
                          </div>
                        </div>
                      ) : (
                        <Button
                          onClick={requestVehicleQuote}
                          disabled={requestingQuote}
                          className="w-full h-12 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-full"
                        >
                          {requestingQuote ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              {language === 'fr' ? 'Envoi...' : 'Requesting...'}
                            </>
                          ) : (
                            <>
                              <Car className="h-4 w-4 mr-2" />
                              {language === 'fr' ? 'Demander un devis' : 'Request Shipping Quote'}
                            </>
                          )}
                        </Button>
                      )
                    ) : user ? (
                      <Link to="/checkout" className="block">
                        <Button className="w-full h-12 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full">
                          {shop.proceedToCheckout || 'Proceed to Checkout'}
                        </Button>
                      </Link>
                    ) : (
                      <>
                        <Link to="/shop-auth?redirect=/checkout" className="block">
                          <Button className="w-full h-12 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full">
                            {shop.signInToCheckout || 'Sign In to Checkout'}
                          </Button>
                        </Link>
                        <p className="text-xs text-white/40 text-center">
                          {shop.signInToCheckoutHint || 'You need to sign in to complete your order'}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
      <BottomNavigation />
    </div>
  );
}
