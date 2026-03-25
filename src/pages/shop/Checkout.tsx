import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, CreditCard, Building2, Smartphone, CheckCircle2, MapPin, Edit3, Car, AlertTriangle, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { CheckoutInlineLogin } from '@/components/shop/CheckoutInlineLogin';
import { PriceBreakdown } from '@/components/shop/PriceBreakdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useShopCart } from '@/contexts/ShopCartContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

interface ShippingAddress {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateProvince: string;
  postalCode: string;
  country: string;
}

export default function Checkout() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { 
    items, loading: cartLoading, initialized, totalUsd, savePendingCheckout, restoreFromPendingCheckout, 
    vehicleQuoteStatus, serverTotalUsd,
    selectedItems, selectedTotalUsd, selectedHasVehicleItems, selectedCanProceedToPayment
  } = useShopCart();
  const { user, session, isAuthReady } = useAuth();
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = (t.shop || {}) as any;
  const sessionUser = session?.user ?? user;
  
  const [loading, setLoading] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('mobile_money');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showTermsDialog, setShowTermsDialog] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [orderServerTotal, setOrderServerTotal] = useState<number | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [promoCode, setPromoCode] = useState('');
  const [promoApplied, setPromoApplied] = useState<{ code: string; percent: number } | null>(null);
  const [promoError, setPromoError] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [address, setAddress] = useState<ShippingAddress>({
    fullName: '',
    phone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    stateProvince: '',
    postalCode: '',
    country: 'DR Congo',
  });

  // Use selected items for checkout — fallback to all items if none selected
  const checkoutItems = selectedItems.length > 0 ? selectedItems : items;
  const checkoutTotal = selectedItems.length > 0 ? selectedTotalUsd : totalUsd;

  // Restore cart from pending checkout only if cart is genuinely empty AFTER initialization + loading, attempt once
  const didAttemptRestoreRef = useRef(false);
  useEffect(() => {
    if (didAttemptRestoreRef.current) return;
    if (!initialized) return;

    if (!cartLoading && items.length === 0) {
      didAttemptRestoreRef.current = true;
      const restored = restoreFromPendingCheckout();
      if (restored) {
        console.log('[CHECKOUT] Cart restored from pending snapshot (confirmed empty)');
      }
      return;
    }

    if (!cartLoading && items.length > 0) {
      didAttemptRestoreRef.current = true;
    }
  }, [initialized, cartLoading, items.length]);

  // Load profile data
  useEffect(() => {
    const loadProfile = async () => {
      if (!sessionUser) return;
      
      try {
        console.log('[CHECKOUT] Loading profile for user:', sessionUser.id);
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', sessionUser.id)
          .single();

        if (data) {
          setAddress({
            fullName: data.name || data.full_name || '',
            phone: data.phone || '',
            addressLine1: data.address_line1 || '',
            addressLine2: data.address_line2 || '',
            city: data.city || '',
            stateProvince: data.state_province || '',
            postalCode: data.postal_code || '',
            country: data.country || 'DR Congo',
          });
          console.log('[CHECKOUT] Profile loaded, hasAddress:', !!(data.address_line1));
        }
      } catch (error) {
        console.error('Failed to load profile:', error);
      } finally {
        setLoadingProfile(false);
      }
    };

    loadProfile();
  }, [sessionUser]);

  // Check if user has a saved address
  const hasSavedAddress = useMemo(() => {
    return !!(address.fullName && address.country);
  }, [address]);

  const handleApplyPromo = useCallback(async () => {
    if (!promoCode.trim()) return;
    setPromoLoading(true);
    setPromoError('');
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('discount_codes')
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      const codes = (data?.discount_codes || []) as Array<{ code: string; percent: number; active: boolean }>;
      const match = codes.find(c => c.code === promoCode.trim().toUpperCase() && c.active);
      if (match) {
        setPromoApplied({ code: match.code, percent: match.percent });
        setPromoError('');
      } else {
        setPromoError(language === 'fr' ? 'Code invalide ou expiré' : 'Invalid or expired code');
        setPromoApplied(null);
      }
    } catch {
      setPromoError(language === 'fr' ? 'Erreur de vérification' : 'Verification error');
    } finally {
      setPromoLoading(false);
    }
  }, [promoCode, language]);

  const handleInputChange = (field: keyof ShippingAddress, value: string) => {
    setAddress(prev => ({ ...prev, [field]: value }));
  };

  const processCheckout = useCallback(async () => {
    if (checkoutItems.length === 0) {
      toast({
        title: shop.emptyCartTitle || 'Empty Cart',
        description: shop.emptyCart || 'Your cart is empty',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    setCheckoutError(null);
    try {
      // Update profile with shipping address
      await supabase
        .from('profiles')
        .update({
          name: address.fullName,
          phone: address.phone,
          address_line1: address.addressLine1,
          address_line2: address.addressLine2,
          city: address.city,
          state_province: address.stateProvince,
          postal_code: address.postalCode,
          country: address.country,
        })
        .eq('user_id', sessionUser?.id);

      // Log funnel step: order_created
      const logFunnel = async (step: string, status: string, errorMessage?: string, meta?: Record<string, any>) => {
        try {
          await supabase.from('checkout_funnel_log').insert({
            user_id: sessionUser?.id,
            step,
            status,
            error_message: errorMessage || null,
            metadata: meta || {},
          });
        } catch { /* non-blocking */ }
      };

      // Step 1: Create/update DRAFT order from cart items
      const selectedCartItemIds = checkoutItems.map(i => i.id).filter(id => !id.startsWith('local_'));
      console.log('[WEB_CHECKOUT] Step 1: Creating order from cart... selectedIds=', selectedCartItemIds.length);
      
      const { data: orderData, error: orderError } = await supabase.functions.invoke(
        'mobile-orders',
        {
          body: { action: 'create', ...(selectedCartItemIds.length > 0 ? { cart_item_ids: selectedCartItemIds } : {}) },
        }
      );

      console.log('[WEB_CHECKOUT] Order response:', { orderData, orderError });

      if (orderError) {
        console.error('[WEB_CHECKOUT] Order creation error:', orderError);
        const errorMsg = orderError.message || orderData?.message || 'Failed to prepare your order.';
        throw new Error(errorMsg);
      }

      if (orderData?.error) {
        console.error('[WEB_CHECKOUT] Order response error:', orderData);
        throw new Error(orderData.message || orderData.error || 'Failed to prepare your order.');
      }

      const orderId = orderData?.order_id || orderData?.orderId;
      const orderItemIds = orderData?.order_item_ids || orderData?.orderItemIds;

      if (!orderId || !orderItemIds) {
        console.error('[WEB_CHECKOUT] Missing order data:', orderData);
        throw new Error('Failed to create order. Please ensure your cart has items.');
      }

      const srvTotal = orderData?.total_usd || orderData?.totalUsd;
      if (srvTotal) setOrderServerTotal(srvTotal);
      const effectiveTotal = srvTotal || checkoutTotal;

      console.log('[WEB_CHECKOUT] Order created:', orderId, 'items:', orderItemIds.length, 'serverTotal:', srvTotal);
      await logFunnel('order_created', 'ok', undefined, { orderId, itemCount: orderItemIds.length });

      // Step 2: Checkout WITH inline provider selection (merged steps 2+3)
      // Determine provider and phone/operator to pass inline
      const providerMap: Record<string, string> = {
        'mobile_money': 'pawapay',
        'card': 'stripe',
      };
      const selectedProvider = providerMap[paymentMethod] || 'pawapay';
      
      const checkoutPayload: Record<string, any> = {
        cart_item_ids: orderItemIds,
        cart_id: orderId,
        provider: selectedProvider, // NEW: Pass provider for inline selection
      };
      
      if (paymentMethod === 'card') {
        checkoutPayload.payment_method_preference = 'CARD';
      }

      // Pass phone and operator for pawapay
      if (selectedProvider === 'pawapay' && address.phone) {
        checkoutPayload.phone = address.phone;
        const cleanPhone = address.phone.replace(/[\s\-+]/g, '');
        let prefix = '';
        if (cleanPhone.startsWith('243')) {
          prefix = cleanPhone.slice(3, 5);
        } else if (cleanPhone.startsWith('0')) {
          prefix = cleanPhone.slice(1, 3);
        } else {
          prefix = cleanPhone.slice(0, 2);
        }
        const operatorMap: Record<string, string> = {
          '81': 'VODACOM_MPESA_COD', '82': 'VODACOM_MPESA_COD', '83': 'VODACOM_MPESA_COD',
          '97': 'AIRTEL_COD', '99': 'AIRTEL_COD',
          '84': 'ORANGE_COD', '85': 'ORANGE_COD', '89': 'ORANGE_COD',
        };
        checkoutPayload.operator = operatorMap[prefix] || 'VODACOM_MPESA_COD';
        console.log('[WEB_CHECKOUT] Detected operator:', checkoutPayload.operator, 'from prefix:', prefix);
      }
      
      console.log('[WEB_CHECKOUT] Step 2: Checkout with inline provider...', { provider: selectedProvider });
      await logFunnel('checkout_started', 'ok', undefined, { provider: selectedProvider, orderId });
      
      const { data, error } = await supabase.functions.invoke('mobile-orders', {
        body: { action: 'checkout', ...checkoutPayload },
      });

      console.log('[WEB_CHECKOUT] Checkout response:', { data, error });

      if (error) {
        console.error('[WEB_CHECKOUT] Checkout error:', error);
        await logFunnel('checkout_failed', 'error', error.message);
        throw new Error(error.message || 'Checkout failed');
      }

      if (data?.error && !data?.success) {
        console.error('[WEB_CHECKOUT] Checkout response error:', data);
        await logFunnel('checkout_failed', 'error', data.message || data.error);
        throw new Error(data.message || data.error || 'Checkout failed');
      }

      // Check for inline provider error (provider was attempted but failed)
      if (data?.provider_error) {
        console.warn('[WEB_CHECKOUT] Inline provider failed, showing error', data.provider_error);
        await logFunnel('provider_failed', 'error', data.provider_error.message);
        const errMsg = language === 'fr' 
          ? (data.provider_error.message_fr || 'Le paiement a échoué. Veuillez réessayer.')
          : (data.provider_error.message || 'Payment failed. Please try again.');
        setCheckoutError(errMsg);
        setLoading(false);
        return;
      }

      // Handle PawaPay USSD response (inline provider succeeded)
      if (data?.provider === 'pawapay' && data?.status === 'pending_user_confirmation') {
        console.log('[WEB_CHECKOUT] PawaPay USSD push initiated (inline), redirecting to pending page');
        await logFunnel('payment_initiated', 'ok', undefined, { provider: 'pawapay', orderId: data.order_id });
        savePendingCheckout({ 
          orderId: data.order_id, 
          paymentMethod: 'mobile_money',
          totalUsd: effectiveTotal 
        });
        navigate(`/payment-pending?order_id=${data.order_id}&provider=pawapay&total_usd=${effectiveTotal}`);
        return;
      }

      // Handle Stripe response (inline provider succeeded)
      if (data?.provider === 'stripe' && data?.clientSecret) {
        console.log('[WEB_CHECKOUT] Stripe clientSecret received (inline), redirecting to card payment');
        await logFunnel('payment_initiated', 'ok', undefined, { provider: 'stripe', orderId: data.order_id });
        savePendingCheckout({ 
          orderId: data.order_id, 
          paymentMethod: 'card',
          totalUsd: effectiveTotal 
        });
        const cardPaymentUrl = `/card-payment?order_id=${data.order_id}&client_secret=${encodeURIComponent(data.clientSecret)}&amount=${data.amount || ''}&currency=${data.currency || 'USD'}`;
        navigate(cardPaymentUrl);
        return;
      }

      // Fallback: Handle awaiting_provider_selection (old backend or inline failed silently)
      if ((data?.status === 'awaiting_provider_selection' || data?.payment_flow === 'CHOICE_REQUIRED') && data?.checkout_session_id) {
        console.log('[WEB_CHECKOUT] Fallback: Step 3 selecting payment provider...');
        await logFunnel('provider_fallback', 'ok', undefined, { checkout_session_id: data.checkout_session_id });
        
        const selectPayload: Record<string, any> = {
          checkout_session_id: data.checkout_session_id,
          provider: selectedProvider,
        };
        
        if (selectedProvider === 'pawapay' && address.phone) {
          selectPayload.phone = address.phone;
          selectPayload.operator = checkoutPayload.operator;
        }
        
        let providerData: any = null;
        try {
          console.log('[WEB_CHECKOUT] Invoking payments-provider fallback');
          const providerResponse = await supabase.functions.invoke(
            'payments-provider',
            { body: { action: 'select', ...selectPayload } }
          );
          providerData = providerResponse.data;
          const providerError = providerResponse.error;
          
          console.log('[WEB_CHECKOUT] Provider fallback response:', JSON.stringify({ providerData, providerError }));
          
          if (providerError) {
            console.error('[WEB_CHECKOUT] Provider fallback error:', JSON.stringify(providerError));
            if (!providerData?.order_id && !providerData?.success) {
              throw new Error(providerData?.message || providerError?.message || 'Failed to initiate payment');
            }
          }
        } catch (invokeErr: any) {
          console.error('[WEB_CHECKOUT] Provider fallback exception:', invokeErr?.message);
          await logFunnel('provider_exception', 'error', invokeErr?.message);
          if (!providerData) {
            setCheckoutError(invokeErr?.message || 'Failed to contact payment provider. Please try again.');
            setLoading(false);
            return;
          }
        }
        
        if (providerData?.error && !providerData?.success) {
          console.error('[WEB_CHECKOUT] Provider response error:', providerData);
          throw new Error(providerData?.message || 'Failed to initiate payment');
        }
        
        if (providerData?.provider === 'pawapay' && providerData?.status === 'pending_user_confirmation') {
          await logFunnel('payment_initiated', 'ok', undefined, { provider: 'pawapay', orderId: providerData.order_id });
          savePendingCheckout({ orderId: providerData.order_id, paymentMethod: 'mobile_money', totalUsd: effectiveTotal });
          navigate(`/payment-pending?order_id=${providerData.order_id}&provider=pawapay&total_usd=${effectiveTotal}`);
          return;
        }
        
        if (providerData?.provider === 'stripe' && providerData?.clientSecret) {
          await logFunnel('payment_initiated', 'ok', undefined, { provider: 'stripe', orderId: providerData.order_id });
          savePendingCheckout({ orderId: providerData.order_id, paymentMethod: 'card', totalUsd: effectiveTotal });
          const cardPaymentUrl = `/card-payment?order_id=${providerData.order_id}&client_secret=${encodeURIComponent(providerData.clientSecret)}&amount=${providerData.amount || data.amount}&currency=${providerData.currency || 'USD'}`;
          navigate(cardPaymentUrl);
          return;
        }
        
        if (providerData?.order_id) {
          savePendingCheckout({ orderId: providerData.order_id, totalUsd: effectiveTotal });
          navigate(`/orders/${providerData.order_id}`);
          return;
        }
      }
      // Legacy flows
      else if (data?.payment_flow === 'STRIPE' && data?.clientSecret) {
        savePendingCheckout({ orderId: data.order_id, paymentMethod: 'card', totalUsd: effectiveTotal });
        navigate(`/payment-callback?session_id=${data.checkout_session_id}`);
      } else if (data?.payment_flow === 'PAWAPAY' && data?.redirectUrl) {
        savePendingCheckout({ orderId: data.order_id, paymentMethod: 'mobile_money', totalUsd: effectiveTotal });
        window.location.href = data.redirectUrl;
      } else if (data?.order_id) {
        savePendingCheckout({ orderId: data.order_id, totalUsd: effectiveTotal });
        navigate(`/orders/${data.order_id}`);
      }
    } catch (error: any) {
      console.error('[WEB_CHECKOUT] Error:', error);
      setCheckoutError(error.message || shop.failedToProcess || 'Failed to process your order');
      toast({
        title: shop.checkoutFailed || 'Checkout Failed',
        description: error.message || shop.failedToProcess || 'Failed to process your order',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [checkoutItems, checkoutTotal, paymentMethod, address, sessionUser, toast, shop, navigate, savePendingCheckout, serverTotalUsd, orderServerTotal, language]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!termsAccepted) {
      setShowTermsDialog(true);
      return;
    }
    processCheckout();
  };

  const handleAcceptTerms = () => {
    setTermsAccepted(true);
    setShowTermsDialog(false);
    processCheckout();
  };

  // Wait only for auth hydration before evaluating checkout access.
  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-black">
        <ShopHeader />
        <div className="flex items-center justify-center pt-24">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      </div>
    );
  }

  if (!session) {
    return <CheckoutInlineLogin language={language} shop={shop} />;
  }

  if (checkoutItems.length === 0) {
    return (
      <div className="min-h-screen bg-black">
        <ShopHeader />
        <div className="pt-24 px-4 text-center">
          <p className="text-white/60 mb-4">{shop.cartEmpty || 'Your cart is empty'}</p>
          <Link to="/">
            <Button className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-full">
              {shop.continueShopping || 'Continue Shopping'}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Block checkout ONLY if selected items include a vehicle needing a quote
  if (!selectedCanProceedToPayment) {
    return (
      <div className="min-h-screen bg-black">
        <ShopHeader />
        <div className="pt-24 px-4 text-center max-w-md mx-auto">
          <Car className="h-16 w-16 text-amber-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">
            {language === 'fr' ? 'Devis requis' : 'Shipping Quote Required'}
          </h2>
          <p className="text-white/60 mb-6">
            {language === 'fr' 
              ? 'Les articles sélectionnés incluent un véhicule. Désélectionnez-le dans le panier ou attendez votre devis.'
              : 'Your selected items include a vehicle. Deselect it in the cart or wait for your shipping quote.'}
          </p>
          <Link to="/cart">
            <Button className="bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-full px-8">
              {language === 'fr' ? 'Retour au panier' : 'Back to Cart'}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      <ShopHeader />

      <main className="pt-24 px-4 pb-safe-nav">
        <div className="container mx-auto max-w-4xl">
          {/* Header */}
          <Link 
            to="/cart" 
            className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-6 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            {shop.backToCart || 'Back to Cart'}
          </Link>
          
          <h1 className="text-2xl font-bold text-white mb-8">{shop.checkoutTitle || 'Checkout'}</h1>

          {/* Checkout Error Banner */}
          {checkoutError && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 rounded-xl border border-red-500/30 bg-red-500/10 flex items-start gap-3"
            >
              <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-red-300 font-medium text-sm">
                  {language === 'fr' ? 'Erreur de paiement' : 'Payment Error'}
                </p>
                <p className="text-red-200/70 text-sm mt-1">{checkoutError}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setCheckoutError(null);
                  processCheckout();
                }}
                className="border-red-500/30 text-red-300 hover:bg-red-500/20 flex-shrink-0"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                {language === 'fr' ? 'Réessayer' : 'Retry'}
              </Button>
            </motion.div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="grid lg:grid-cols-3 gap-8">
              {/* Left Column - Forms */}
              <div className="lg:col-span-2 space-y-8">
                {/* Shipping Address */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-white/5 rounded-2xl border border-white/10 p-6"
                >
                  <h2 className="text-lg font-semibold text-white mb-4">{shop.shippingAddress || 'Shipping Address'}</h2>
                  
                  {loadingProfile ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-white/40" />
                    </div>
                  ) : hasSavedAddress && !editingAddress ? (
                    /* Saved Address Confirmation Card */
                    <div className="space-y-4">
                      <div className="bg-white/5 rounded-xl border border-white/10 p-4">
                        <div className="flex items-start gap-3">
                          <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                            <MapPin className="h-5 w-5 text-green-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white font-medium">{address.fullName}</p>
                            <p className="text-sm text-white/70 mt-1">{address.phone}</p>
                            <p className="text-sm text-white/60 mt-2">
                              {address.addressLine1}
                              {address.addressLine2 && `, ${address.addressLine2}`}
                            </p>
                            <p className="text-sm text-white/60">
                              {address.city}
                              {address.stateProvince && `, ${address.stateProvince}`}
                              {address.postalCode && ` ${address.postalCode}`}
                            </p>
                            <p className="text-sm text-white/60">{address.country}</p>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => setEditingAddress(true)}
                          className="flex items-center gap-2 px-4 py-2 text-sm text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded-lg transition-colors"
                        >
                          <Edit3 className="h-4 w-4" />
                          {shop.editAddress || 'Edit Address'}
                        </button>
                      </div>
                      
                      <p className="text-xs text-green-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {shop.usingSavedAddress || 'Using your saved shipping address'}
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      {hasSavedAddress && editingAddress && (
                        <button
                          type="button"
                          onClick={() => setEditingAddress(false)}
                          className="text-sm text-white/60 hover:text-white mb-2 flex items-center gap-1"
                        >
                          {shop.backToSavedAddress || '← Back to saved address'}
                        </button>
                      )}
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="fullName" className="text-white/70">{shop.fullName || 'Full Name'}</Label>
                          <Input
                            id="fullName"
                            value={address.fullName}
                            onChange={(e) => handleInputChange('fullName', e.target.value)}
                            required
                            className="mt-1 bg-white/5 border-white/10 text-white"
                          />
                        </div>
                        <div>
                          <Label htmlFor="phone" className="text-white/70">{shop.phoneNumber || 'Phone Number'}</Label>
                          <Input
                            id="phone"
                            type="tel"
                            value={address.phone}
                            onChange={(e) => handleInputChange('phone', e.target.value)}
                            required
                            className="mt-1 bg-white/5 border-white/10 text-white"
                          />
                        </div>
                      </div>

                      <div>
                        <Label htmlFor="addressLine1" className="text-white/70">{shop.addressLine1 || 'Address Line 1'}</Label>
                        <Input
                          id="addressLine1"
                          value={address.addressLine1}
                          onChange={(e) => handleInputChange('addressLine1', e.target.value)}
                          required
                          className="mt-1 bg-white/5 border-white/10 text-white"
                        />
                      </div>

                      <div>
                        <Label htmlFor="addressLine2" className="text-white/70">{shop.addressLine2Optional || 'Address Line 2 (Optional)'}</Label>
                        <Input
                          id="addressLine2"
                          value={address.addressLine2}
                          onChange={(e) => handleInputChange('addressLine2', e.target.value)}
                          className="mt-1 bg-white/5 border-white/10 text-white"
                        />
                      </div>

                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="city" className="text-white/70">{shop.city || 'City'}</Label>
                          <Input
                            id="city"
                            value={address.city}
                            onChange={(e) => handleInputChange('city', e.target.value)}
                            required
                            className="mt-1 bg-white/5 border-white/10 text-white"
                          />
                        </div>
                        <div>
                          <Label htmlFor="stateProvince" className="text-white/70">{shop.stateProvince || 'State/Province'}</Label>
                          <Input
                            id="stateProvince"
                            value={address.stateProvince}
                            onChange={(e) => handleInputChange('stateProvince', e.target.value)}
                            className="mt-1 bg-white/5 border-white/10 text-white"
                          />
                        </div>
                      </div>

                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="country" className="text-white/70">{shop.country || 'Country'}</Label>
                          <Input
                            id="country"
                            value={address.country}
                            onChange={(e) => handleInputChange('country', e.target.value)}
                            required
                            className="mt-1 bg-white/5 border-white/10 text-white"
                          />
                        </div>
                        <div>
                          <Label htmlFor="postalCode" className="text-white/70">{shop.postalCodeOptional || 'Postal Code (Optional)'}</Label>
                          <Input
                            id="postalCode"
                            value={address.postalCode}
                            onChange={(e) => handleInputChange('postalCode', e.target.value)}
                            className="mt-1 bg-white/5 border-white/10 text-white"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>

                {/* Payment Method */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="bg-white/5 rounded-2xl border border-white/10 p-6"
                >
                  <h2 className="text-lg font-semibold text-white mb-4">{shop.paymentMethod || 'Payment Method'}</h2>
                  
                  <RadioGroup value={paymentMethod} onValueChange={setPaymentMethod}>
                    <div className="space-y-3">
                      <label className="flex items-center gap-4 p-4 rounded-xl border border-white/10 cursor-pointer hover:bg-white/5 transition-colors">
                        <RadioGroupItem value="mobile_money" id="mobile_money" className="border-white/40" />
                        <Smartphone className="h-5 w-5 text-white/70" />
                        <div className="flex-1">
                          <p className="text-white font-medium">{shop.mobileMoney || 'Mobile Money'}</p>
                          <p className="text-sm text-white/50">M-Pesa, Airtel Money, Orange Money</p>
                        </div>
                      </label>

                      <label className="flex items-center gap-4 p-4 rounded-xl border border-white/10 cursor-pointer hover:bg-white/5 transition-colors">
                        <RadioGroupItem value="card" id="card" className="border-white/40" />
                        <CreditCard className="h-5 w-5 text-white/70" />
                        <div className="flex-1">
                          <p className="text-white font-medium">{shop.creditDebitCard || 'Credit/Debit Card'}</p>
                          <p className="text-sm text-white/50">Visa, Mastercard, AMEX</p>
                        </div>
                      </label>

                    </div>
                  </RadioGroup>
                </motion.div>

              </div>

              {/* Right Column - Order Summary */}
              <div className="lg:col-span-1">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="sticky top-24 bg-white/5 rounded-2xl border border-white/10 p-6"
                >
                  <h2 className="text-lg font-semibold text-white mb-4">{shop.orderSummary || 'Order Summary'}</h2>
                  
                  {/* Items Preview — show selected items */}
                  <div className="space-y-3 mb-4 pb-4 border-b border-white/10">
                    {checkoutItems.slice(0, 3).map((item) => (
                      <div key={item.id} className="flex gap-3">
                        <img
                          src={item.imageUrl || '/placeholder.svg'}
                          alt={item.title}
                          className="w-12 h-12 rounded-lg object-contain bg-white/5"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white/80 line-clamp-1">{item.title}</p>
                          <p className="text-xs text-white/50">{shop.qty || 'Qty'}: {item.quantity}</p>
                        </div>
                      </div>
                    ))}
                    {checkoutItems.length > 3 && (
                      <p className="text-sm text-white/50">
                        +{checkoutItems.length - 3} {checkoutItems.length - 3 !== 1 ? (shop.moreItems || 'more items') : (shop.moreItem || 'more item')}
                      </p>
                    )}
                  </div>

                  {/* Promo Code */}
                  <div className="mb-4 pb-4 border-b border-white/10">
                    <label className="text-sm text-white/70 mb-2 block">
                      {language === 'fr' ? 'Code promo' : 'Promo Code'}
                    </label>
                    <div className="flex gap-2">
                      <Input
                        value={promoCode}
                        onChange={(e) => {
                          setPromoCode(e.target.value.toUpperCase());
                          if (promoApplied) { setPromoApplied(null); setPromoError(''); }
                        }}
                        placeholder={language === 'fr' ? 'Ex: SAVE10' : 'e.g. SAVE10'}
                        className="bg-white/5 border-white/10 text-white text-sm"
                        disabled={!!promoApplied}
                      />
                      {promoApplied ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => { setPromoApplied(null); setPromoCode(''); setPromoError(''); }}
                          className="border-white/20 text-white/70 hover:bg-white/10 whitespace-nowrap"
                        >
                          {language === 'fr' ? 'Retirer' : 'Remove'}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleApplyPromo}
                          disabled={promoLoading || !promoCode.trim()}
                          className="bg-white/10 hover:bg-white/20 text-white whitespace-nowrap"
                        >
                          {promoLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (language === 'fr' ? 'Appliquer' : 'Apply')}
                        </Button>
                      )}
                    </div>
                    {promoError && <p className="text-xs text-red-400 mt-1">{promoError}</p>}
                    {promoApplied && (
                      <p className="text-xs text-green-400 mt-1 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {language === 'fr' ? `${promoApplied.percent}% de réduction appliquée` : `${promoApplied.percent}% discount applied`}
                      </p>
                    )}
                  </div>
                  
                  <PriceBreakdown 
                    itemPriceUsd={checkoutTotal} 
                    serverTotal={orderServerTotal ?? serverTotalUsd} 
                    isFixedPrice={checkoutItems.length > 0 && checkoutItems.every(item => item.isFixedPrice)}
                    discountPercent={promoApplied?.percent}
                  />

                  <Button
                    type="submit"
                    disabled={loading}
                    className="w-full h-12 mt-6 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        {shop.processing || 'Processing...'}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        {shop.placeOrder || 'Place Order'}
                      </>
                    )}
                  </Button>
                </motion.div>
              </div>
            </div>
          </form>
        </div>
      </main>

      {/* Terms & Conditions Dialog */}
      <Dialog open={showTermsDialog} onOpenChange={setShowTermsDialog}>
        <DialogContent className="bg-zinc-900 border-white/10 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-white text-lg">
              {language === 'fr' ? 'Conditions Générales' : 'Terms & Conditions'}
            </DialogTitle>
            <DialogDescription className="text-white/70 pt-2">
              {language === 'fr'
                ? 'Veuillez lire et accepter nos conditions avant de finaliser votre commande.'
                : 'Please review and accept our terms before completing your order.'}
              <br /><br />
              <Link to="/terms" className="text-blue-400 hover:underline" onClick={() => setShowTermsDialog(false)}>
                {shop.termsOfService || 'Terms of Service'}
              </Link>
              {' '}{shop.and || (language === 'fr' ? 'et' : 'and')}{' '}
              <Link to="/privacy" className="text-blue-400 hover:underline" onClick={() => setShowTermsDialog(false)}>
                {shop.privacyPolicy || 'Privacy Policy'}
              </Link>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row gap-3 sm:justify-end pt-2">
            <Button
              variant="outline"
              onClick={() => setShowTermsDialog(false)}
              className="flex-1 sm:flex-none border-white/20 text-white hover:bg-white/10"
            >
              {language === 'fr' ? 'Refuser' : 'Decline'}
            </Button>
            <Button
              onClick={handleAcceptTerms}
              className="flex-1 sm:flex-none bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white"
            >
              {language === 'fr' ? 'Accepter et Continuer' : 'Accept & Continue'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
