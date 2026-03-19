import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ShoppingBag, Trash2, Plus, Minus, Car, Loader2, FileText, CheckSquare, Square, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { PriceBreakdown } from '@/components/shop/PriceBreakdown';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useShopCart } from '@/contexts/ShopCartContext';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export default function ShopCart() {
  const { 
    items, loading, updateQuantity, removeItem, clearCart, restoreFromPendingCheckout, 
    hasVehicleItems, vehicleQuoteStatus, syncCart, markQuoteRequested,
    selectedItemIds, toggleItemSelection, selectAllItems, deselectAllItems,
    selectedItems, selectedTotalUsd, selectedHasVehicleItems, selectedCanProceedToPayment
  } = useShopCart();
  const { user, session, isAuthReady } = useAuth();
  const { language } = useLanguage();
  const { toast } = useToast();
  const t = translations[language] || translations.en;
  const shop = (t.shop || {}) as any;
  const [requestingQuote, setRequestingQuote] = useState(false);

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const allSelected = items.length > 0 && selectedItemIds.size === items.length;
  const noneSelected = selectedItemIds.size === 0;

  const handlePayerButtonClick = () => {
    console.log('[CART] Payer button pressed', {
      hasSession: !!session,
      hasUser: !!user,
      isAuthReady,
      selectedCount: selectedItemIds.size,
      selectedCanProceedToPayment,
    });
  };

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
      const { data, error } = await supabase.functions.invoke('mobile-orders', { body: { action: 'request_quote' } });
      if (error) throw error;
      // Optimistically update UI immediately
      markQuoteRequested();
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
    <div className="min-h-screen bg-black pb-safe-nav">
      <ShopHeader />

      <main className="pt-24 px-3 sm:px-4 pb-36">
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
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    {shop.clearCart || 'Clear Cart'}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="bg-zinc-900 border-white/10">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-white">
                      {language === 'fr' ? 'Vider votre panier ?' : 'Clear your cart?'}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-white/60">
                      {language === 'fr'
                        ? 'Tous les articles seront supprimés de votre panier. Cette action est irréversible.'
                        : 'This will remove all items from your cart. This action cannot be undone.'}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="bg-white/5 border-white/10 text-white hover:bg-white/10">
                      {language === 'fr' ? 'Annuler' : 'Cancel'}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => clearCart()}
                      className="bg-red-600 hover:bg-red-700 text-white"
                    >
                      {language === 'fr' ? 'Oui, vider' : 'Yes, clear it'}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
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
                {/* Select All / Deselect All */}
                <div className="flex items-center justify-between px-2">
                  <button
                    onClick={allSelected ? deselectAllItems : selectAllItems}
                    className="flex items-center gap-2 text-sm text-white/70 hover:text-white transition-colors"
                  >
                    {allSelected ? (
                      <CheckSquare className="h-4 w-4 text-blue-400" />
                    ) : (
                      <Square className="h-4 w-4" />
                    )}
                    {allSelected 
                      ? (language === 'fr' ? 'Tout désélectionner' : 'Deselect All')
                      : (language === 'fr' ? 'Tout sélectionner' : 'Select All')
                    }
                  </button>
                  <p className="text-xs text-white/40">
                    {selectedItemIds.size} / {items.length} {language === 'fr' ? 'sélectionné(s)' : 'selected'}
                  </p>
                </div>

                {items.map((item, index) => {
                  const isSelected = selectedItemIds.has(item.id);
                  return (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className={`flex gap-2 sm:gap-4 p-3 sm:p-4 rounded-2xl border transition-colors ${
                        isSelected 
                          ? 'bg-white/5 border-blue-500/30' 
                          : 'bg-white/[0.02] border-white/5 opacity-60'
                      }`}
                    >
                      {/* Checkbox */}
                      <div className="flex items-center pt-1">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleItemSelection(item.id)}
                          className="border-white/40 data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500"
                        />
                      </div>

                      {/* Image */}
                      <Link 
                        to={`/product/${item.provider}/${encodeURIComponent(item.productId)}`}
                        state={{ product: { id: item.productId, provider: item.provider, title: item.title, imageUrl: item.imageUrl, priceUsd: item.priceUsd, isVehicle: item.isVehicle, productUrl: item.productUrl } }}
                        className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl overflow-hidden bg-white/5 flex-shrink-0"
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
                          state={{ product: { id: item.productId, provider: item.provider, title: item.title, imageUrl: item.imageUrl, priceUsd: item.priceUsd, isVehicle: item.isVehicle, productUrl: item.productUrl } }}
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
                          <div className="space-y-3 mt-1">
                            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
                              <Car className="h-3 w-3 mr-1" />
                              {language === 'fr' ? 'Véhicule — Devis requis' : 'Vehicle — Quote Required'}
                            </Badge>

                            {user && vehicleQuoteStatus === 'none' && (
                              <div className="border border-amber-500/40 bg-amber-500/10 rounded-lg p-3 shadow-[0_0_12px_rgba(245,158,11,0.15)]">
                                <Button
                                  onClick={(e) => { e.preventDefault(); requestVehicleQuote(); }}
                                  disabled={requestingQuote}
                                  className="w-full h-10 text-sm font-semibold bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white rounded-lg animate-pulse hover:animate-none whitespace-normal px-2 sm:px-4"
                                >
                                  {requestingQuote ? (
                                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{language === 'fr' ? 'Envoi en cours...' : 'Requesting...'}</>
                                  ) : (
                                    <><FileText className="h-4 w-4 mr-2" />{language === 'fr' ? 'Demander un devis' : 'Request a Quote'}</>
                                  )}
                                </Button>
                              </div>
                            )}

                            {user && vehicleQuoteStatus === 'pending' && (
                              <div className="flex items-center gap-2 border border-amber-500/30 bg-amber-500/10 rounded-lg px-3 py-2">
                                <Loader2 className="h-4 w-4 text-amber-400 animate-spin shrink-0" />
                                <span className="text-sm font-medium text-amber-300">
                                  {language === 'fr' ? 'Devis en attente — Vous serez notifié' : 'Quote Pending — You\'ll be notified'}
                                </span>
                              </div>
                            )}

                            {user && vehicleQuoteStatus === 'quoted' && (
                              <div className="flex items-center gap-2 border border-green-500/30 bg-green-500/10 rounded-lg px-3 py-2">
                                <FileText className="h-4 w-4 text-green-400 shrink-0" />
                                <span className="text-sm font-medium text-green-300">
                                  {language === 'fr' ? 'Devis reçu' : 'Quote Received'}
                                </span>
                              </div>
                            )}
                          </div>
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
                  );
                })}
              </div>

              {/* Order Summary — based on SELECTED items only */}
              <div className="lg:col-span-1">
                <div className="sticky top-24 bg-white/5 rounded-2xl border border-white/10 p-4 sm:p-6">
                  <h2 className="text-lg font-semibold text-white mb-4">{shop.orderSummary || 'Order Summary'}</h2>

                  {noneSelected ? (
                    <p className="text-white/50 text-sm mb-4">
                      {language === 'fr' ? 'Sélectionnez des articles pour voir le résumé' : 'Select items to see summary'}
                    </p>
                  ) : (
                    <>
                      <p className="text-xs text-white/40 mb-3">
                        {selectedItemIds.size} {selectedItemIds.size !== 1 ? (shop.items || 'items') : (shop.item || 'item')} {language === 'fr' ? 'sélectionné(s)' : 'selected'}
                      </p>
                      <PriceBreakdown 
                        itemPriceUsd={selectedHasVehicleItems && vehicleQuoteStatus === 'quoted'
                          ? selectedItems.reduce((sum, i) => sum + (i.isVehicle ? 0 : i.priceUsd * i.quantity) + (i.isVehicle ? (i.priceUsd - (i.itemMarginUsd || 0) - (i.itemShippingUsd || 0)) * i.quantity : 0), 0)
                          : selectedTotalUsd
                        }
                        showDetails={true}
                        isVehicle={selectedHasVehicleItems}
                        serverMarginUsd={selectedHasVehicleItems && vehicleQuoteStatus === 'quoted'
                          ? selectedItems.reduce((sum, i) => sum + (i.itemMarginUsd || 0), 0)
                          : undefined
                        }
                        serverShippingUsd={selectedHasVehicleItems && vehicleQuoteStatus === 'quoted'
                          ? selectedItems.reduce((sum, i) => sum + (i.itemShippingUsd || 0), 0)
                          : undefined
                        }
                        serverLineTotalUsd={selectedHasVehicleItems && vehicleQuoteStatus === 'quoted'
                          ? selectedItems.reduce((sum, i) => sum + (i.itemTotalUsd || i.priceUsd * i.quantity), 0)
                          : undefined
                        }
                      />
                    </>
                  )}

                  <div className="mt-6 space-y-3">
                    {/* Vehicle quote warning — only if a vehicle is SELECTED */}
                    {selectedHasVehicleItems && vehicleQuoteStatus !== 'quoted' && user ? (
                      vehicleQuoteStatus === 'pending' ? (
                        <div className="text-center space-y-2">
                          <div className="flex items-center justify-center gap-2 text-amber-400 text-sm">
                            <FileText className="h-4 w-4" />
                            {language === 'fr' ? 'Devis en attente — Vous serez notifié par email' : 'Quote pending — You\'ll be notified by email'}
                          </div>
                          <p className="text-xs text-white/40">
                            {language === 'fr' 
                              ? 'Désélectionnez le véhicule pour payer les autres articles maintenant' 
                              : 'Deselect the vehicle to pay for other items now'}
                          </p>
                        </div>
                      ) : (
                        <>
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
                          <p className="text-xs text-white/40 text-center">
                            {language === 'fr' 
                              ? 'Ou désélectionnez le véhicule pour payer les autres articles' 
                              : 'Or deselect the vehicle to pay for other items'}
                          </p>
                        </>
                      )
                    ) : user ? (
                      <Link to="/checkout" className="block">
                        <Button 
                          disabled={noneSelected || !selectedCanProceedToPayment}
                          className="w-full h-12 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full disabled:opacity-40"
                        >
                          {shop.proceedToCheckout || 'Proceed to Checkout'}
                          {!noneSelected && ` (${selectedItemIds.size})`}
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
