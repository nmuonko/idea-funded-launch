import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Loader2, CreditCard, Building2, Smartphone, CheckCircle2, MapPin, Edit3, Car, AlertTriangle, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { CheckoutInlineLogin } from '@/components/shop/CheckoutInlineLogin';
import { PriceBreakdown } from '@/components/shop/PriceBreakdown';
import { PaymentPlanSelector, type PaymentPlan } from '@/components/shop/PaymentPlanSelector';
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
import { trackInitiateCheckout } from '@/lib/tiktokPixel';
import { trackMetaInitiateCheckout } from '@/lib/metaPixel';
import { sanitizeCartImage } from '@/lib/imageValidation';
import { cleanProductText } from '@/lib/cleanProductText';


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

interface HotProductCheckoutData {
  id: string;
  title: string;
  image_url: string;
  total_price_usd: number;
  provider: string;
  provider_product_id?: string;
  product_url?: string;
}

const buildHotProductSourceUrl = (product: HotProductCheckoutData) => {
  // Ignore internal synthetic URLs accidentally stored by older admin flows.
  const stored = product.product_url?.trim();
  const isSynthetic = !!stored && /afrishop-usa\.com\/(product\/|paste-link|share\/hp\/)/i.test(stored);
  if (stored && !isSynthetic) return stored;

  const provider = (product.provider || '').toLowerCase();
  const rawId = product.provider_product_id?.trim();
  if (!rawId) return stored || null;

  if (provider === 'ebay') {
    const ebayItemId = rawId.startsWith('v1|') ? rawId.split('|')[1] || rawId : rawId;
    return `https://www.ebay.com/itm/${ebayItemId}`;
  }

  let cleanId = rawId;
  if (cleanId.toLowerCase().startsWith('amazon_')) cleanId = cleanId.slice(7);
  if (cleanId.toLowerCase().startsWith('rainforest_')) cleanId = cleanId.slice(11);
  return `https://www.amazon.com/dp/${cleanId.toUpperCase()}`;
};

export default function Checkout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { 
    items, loading: cartLoading, initialized, totalUsd, savePendingCheckout, restoreFromPendingCheckout, 
    vehicleQuoteStatus, serverTotalUsd,
    selectedItems, selectedTotalUsd, selectedHasVehicleItems, selectedCanProceedToPayment,
    addItem
  } = useShopCart();
  const { user, session, isAuthReady } = useAuth();
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = (t.shop || {}) as any;
  const sessionUser = session?.user ?? user;

  // --- Hot product from URL query param (survives refresh & sharing) ---
  const hotProductId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('hp') || null;
  }, [location.search]);
  const catalogItemId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('ci') || null;
  }, [location.search]);
  const directCheckoutId = hotProductId || catalogItemId;

  const [sharedHotProduct, setSharedHotProduct] = useState<HotProductCheckoutData | null>(() => {
    const state = location.state as any;
    return state?.hotProduct ?? null;
  });
  const [loadingSharedProduct, setLoadingSharedProduct] = useState(!!directCheckoutId && !(location.state as any)?.hotProduct);
  const hotProductHydratedRef = useRef(false);

  // Fetch hot product from DB when we only have the URL param (no router state)
  useEffect(() => {
    if (!directCheckoutId || sharedHotProduct) {
      setLoadingSharedProduct(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        if (hotProductId) {
          const { data } = await supabase
            .from('hot_products_showcase')
            .select('id, title, image_url, total_price_usd, provider, provider_product_id, product_url')
            .eq('id', hotProductId)
            .eq('is_active', true)
            .single();
          if (!cancelled && data) setSharedHotProduct(data as HotProductCheckoutData);
        } else if (catalogItemId) {
          const { data } = await supabase
            .from('catalog_items')
            .select('id, title, image_url, price_usd, provider, provider_product_id, product_url')
            .eq('id', catalogItemId)
            .eq('is_active', true)
            .single();
          if (!cancelled && data) {
            setSharedHotProduct({
              id: data.id,
              title: data.title,
              image_url: data.image_url,
              total_price_usd: Number(data.price_usd),
              provider: data.provider,
              provider_product_id: data.provider_product_id,
              product_url: data.product_url,
            });
          }
        }
      } catch (e) {
        console.error('[CHECKOUT] Failed to fetch direct checkout product:', e);
      } finally {
        if (!cancelled) setLoadingSharedProduct(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [directCheckoutId, hotProductId, catalogItemId, sharedHotProduct]);

  // Auto-add hot product to cart once (so processCheckout can use real cart items)
  useEffect(() => {
    if (!sharedHotProduct || hotProductHydratedRef.current || !initialized) return;
    hotProductHydratedRef.current = true;

    const hpUrl = buildHotProductSourceUrl(sharedHotProduct);
    if (!hpUrl) return;

    // Check if already in cart
    const alreadyInCart = items.some(i =>
      i.productUrl?.trim().toLowerCase() === hpUrl.trim().toLowerCase()
    );
    if (alreadyInCart) return;

    const addedFlag = `hp_added_checkout_${sharedHotProduct.id}`;
    if (sessionStorage.getItem(addedFlag)) return;
    sessionStorage.setItem(addedFlag, '1');

    void addItem({
      productId: sharedHotProduct.provider_product_id || hpUrl,
      provider: sharedHotProduct.provider,
      title: cleanProductText(sharedHotProduct.title),
      imageUrl: sharedHotProduct.image_url,
      priceUsd: sharedHotProduct.total_price_usd,
      quantity: 1,
      productUrl: hpUrl,
      isFixedPrice: true,
    });
  }, [sharedHotProduct, initialized, items, addItem]);
  
  const [loading, setLoading] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('mobile_money');
  const [paymentPlan, setPaymentPlan] = useState<PaymentPlan>('full');
  const [termsAccepted, setTermsAccepted] = useState(false);

  const [showTermsDialog, setShowTermsDialog] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [orderServerTotal, setOrderServerTotal] = useState<number | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
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

  // Build fallback items from shared hot product (URL param or router state)
  const hotProductFallbackItems = useMemo(() => {
    if (!sharedHotProduct) return [];
    const hpUrl = buildHotProductSourceUrl(sharedHotProduct);
    return [{
      id: `local_hp_${sharedHotProduct.id}`,
      productId: sharedHotProduct.provider_product_id || hpUrl || sharedHotProduct.id,
      provider: sharedHotProduct.provider,
      title: cleanProductText(sharedHotProduct.title),
      imageUrl: sharedHotProduct.image_url,
      priceUsd: sharedHotProduct.total_price_usd,
      quantity: 1,
      productUrl: hpUrl,
      isFixedPrice: true,
      itemTotalUsd: sharedHotProduct.total_price_usd,
    }];
  }, [sharedHotProduct]);

  // When ?hp= or ?ci= is present, ONLY show that single product (direct Sophie checkout)
  // Otherwise use cart items normally
  const effectiveCheckoutItems = directCheckoutId && hotProductFallbackItems.length > 0
    ? hotProductFallbackItems
    : (checkoutItems.length > 0 ? checkoutItems : hotProductFallbackItems);
  const effectiveCheckoutTotal = directCheckoutId && sharedHotProduct
    ? sharedHotProduct.total_price_usd
    : (checkoutItems.length > 0 ? checkoutTotal : (sharedHotProduct?.total_price_usd ?? 0));

  // Deposit plan eligibility: total >= $100 AND no vehicle items.
  // Hot products are never vehicles. Cart vehicle check uses ShopCartContext flag.
  const isFr = language === 'fr';
  const hasVehicleInCheckout = directCheckoutId ? false : (selectedHasVehicleItems || false);
  const depositEligible = effectiveCheckoutTotal >= 100 && !hasVehicleInCheckout;
  const depositIneligibleReason = !depositEligible
    ? hasVehicleInCheckout
      ? (isFr ? 'Indisponible pour les véhicules.' : 'Not available for vehicle purchases.')
      : (isFr ? 'Disponible à partir de 100$.' : 'Available on orders of $100 or more.')
    : undefined;

  // If user had picked deposit but cart changed and it's no longer eligible, snap back to full.
  useEffect(() => {
    if (!depositEligible && paymentPlan === 'deposit') setPaymentPlan('full');
  }, [depositEligible, paymentPlan]);



  // Restore cart from pending checkout only if cart is genuinely empty AFTER initialization + loading, attempt once
  const didAttemptRestoreRef = useRef(false);
  useEffect(() => {
    if (didAttemptRestoreRef.current) return;
    if (directCheckoutId) { didAttemptRestoreRef.current = true; return; }
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
  }, [directCheckoutId, initialized, cartLoading, items.length, restoreFromPendingCheckout]);

  // Meta Pixel: InitiateCheckout — fire once when /checkout opens with a non-zero total
  const metaInitiateFiredRef = useRef(false);
  useEffect(() => {
    if (metaInitiateFiredRef.current) return;
    if (effectiveCheckoutTotal && effectiveCheckoutTotal > 0) {
      metaInitiateFiredRef.current = true;
      trackMetaInitiateCheckout(effectiveCheckoutTotal);
    }
  }, [effectiveCheckoutTotal]);

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

  const handleInputChange = (field: keyof ShippingAddress, value: string) => {
    setAddress(prev => ({ ...prev, [field]: value }));
  };

  const processCheckout = useCallback(async () => {
    if (effectiveCheckoutItems.length === 0) {
      toast({
        title: shop.emptyCartTitle || 'Empty Cart',
        description: shop.emptyCart || 'Your cart is empty',
        variant: 'destructive',
      });
      return;
    }

    // TikTok Pixel + Server: InitiateCheckout
    trackInitiateCheckout(effectiveCheckoutTotal, {
      email: sessionUser?.email ?? undefined,
      userId: sessionUser?.id ?? undefined,
    });
    // Meta Pixel InitiateCheckout already fired on /checkout mount

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

      // Step 1: Ensure any visible local-only items are persisted to the backend cart first
      const localOnlyCheckoutItems = effectiveCheckoutItems.filter(item => item.id.startsWith('local_'));
      const syncedLocalItemIds: string[] = [];
      if (localOnlyCheckoutItems.length > 0) {
        console.log('[WEB_CHECKOUT] Sync fallback: persisting local-only items before order creation...', localOnlyCheckoutItems.length);
        const normalizeCheckoutUrl = (value?: string | null) => {
          if (!value) return '';
          try {
            const url = new URL(value);
            return `${url.hostname.replace(/^www\./, '').toLowerCase()}${url.pathname.replace(/\/+$/, '').toLowerCase()}`;
          } catch {
            return value.trim().toLowerCase();
          }
        };
        const { data: currentCartData } = await supabase.functions.invoke('mobile-cart', {
          body: { action: 'get_cart' },
        });
        const currentServerItems = currentCartData?.activeItems || currentCartData?.items || [];

        for (const item of localOnlyCheckoutItems) {
          if (!item.productUrl) {
            throw new Error('A cart item is missing its product link. Please add it again before checkout.');
          }

          const existingServerItem = currentServerItems.find((serverItem: any) =>
            normalizeCheckoutUrl(serverItem.productUrl || serverItem.product_url) === normalizeCheckoutUrl(item.productUrl)
          );
          if (existingServerItem?.id) {
            syncedLocalItemIds.push(existingServerItem.id);
            continue;
          }

          const { data: syncData, error: syncError } = await supabase.functions.invoke('mobile-cart', {
            body: {
              action: 'add_item',
              productUrl: item.productUrl,
              productPrice: item.priceUsd,
              quantity: item.quantity,
              productTitle: item.title,
              productImageUrl: item.imageUrl,
              ...(item.isFixedPrice ? { isFixedPrice: true } : {}),
            },
          });

          if (syncError || syncData?.success === false || syncData?.ok === false) {
            throw new Error(syncError?.message || syncData?.message || syncData?.error || 'Failed to sync your cart before checkout.');
          }

          const serverItemId = syncData?.item?.id || syncData?.itemId || syncData?.cart_item_id;
          if (serverItemId && typeof serverItemId === 'string' && !serverItemId.startsWith('local_')) {
            syncedLocalItemIds.push(serverItemId);
          }
        }
      }

      // Step 2: Create/update DRAFT order from cart items
      const selectedCartItemIds = Array.from(new Set([
        ...effectiveCheckoutItems.map(i => i.id).filter(id => !id.startsWith('local_')),
        ...syncedLocalItemIds,
      ]));
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

      // ============================================
      // DEPOSIT BRANCH: Pay 30% now, 70% on arrival.
      // Skip mobile-orders 'checkout' (which would charge the full amount via Stripe/pawaPay)
      // and call create-partial-payment with kind='deposit' instead.
      // The default 'full' path below remains untouched.
      // ============================================
      if (paymentPlan === 'deposit' && depositEligible) {
        const providerForDeposit = paymentMethod === 'card' ? 'stripe' : 'pawapay';
        const partialPayload: Record<string, any> = {
          order_id: orderId,
          kind: 'deposit',
          provider: providerForDeposit,
        };
        if (providerForDeposit === 'pawapay' && address.phone) {
          partialPayload.phone = address.phone;
        }

        await logFunnel('checkout_started', 'ok', undefined, { provider: providerForDeposit, orderId, plan: 'deposit' });

        const { data: partial, error: partialErr } = await supabase.functions.invoke('create-partial-payment', {
          body: partialPayload,
        });

        if (partialErr || !partial?.success) {
          const msg = partial?.error || partialErr?.message || (isFr ? 'Échec du paiement d\'acompte' : 'Deposit payment failed');
          await logFunnel('checkout_failed', 'error', msg, { plan: 'deposit' });
          setCheckoutError(msg);
          setLoading(false);
          return;
        }

        const depositAmount = Number(partial.amount || 0);

        if (partial.provider === 'stripe' && partial.clientSecret) {
          await logFunnel('payment_initiated', 'ok', undefined, { provider: 'stripe', orderId, plan: 'deposit' });
          savePendingCheckout({ orderId, paymentMethod: 'card', totalUsd: depositAmount });
          navigate(`/card-payment?order_id=${orderId}&client_secret=${encodeURIComponent(partial.clientSecret)}&amount=${depositAmount}&currency=USD&plan=deposit`);
          return;
        }

        if (partial.provider === 'pawapay') {
          await logFunnel('payment_initiated', 'ok', undefined, { provider: 'pawapay', orderId, plan: 'deposit' });
          savePendingCheckout({ orderId, paymentMethod: 'mobile_money', totalUsd: depositAmount });
          navigate(`/payment-pending?order_id=${orderId}&provider=pawapay&total_usd=${depositAmount}&plan=deposit`);
          return;
        }

        setCheckoutError(isFr ? 'Réponse inattendue du fournisseur d\'acompte' : 'Unexpected deposit provider response');
        setLoading(false);
        return;
      }



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
  }, [effectiveCheckoutItems, effectiveCheckoutTotal, paymentMethod, paymentPlan, depositEligible, isFr, address, sessionUser, toast, shop, navigate, savePendingCheckout, serverTotalUsd, orderServerTotal, language]);

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
  if (!isAuthReady || loadingSharedProduct) {
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
    // items may still be empty if cart context hasn't hydrated yet — fall back to localStorage, then router state
    const displayItems = directCheckoutId && hotProductFallbackItems.length > 0 ? hotProductFallbackItems : items.length > 0 ? items : (() => {
      try {
        const raw = localStorage.getItem('afrishop_cart');
        const parsed = raw ? JSON.parse(raw) : [];
        if (parsed.length > 0) return parsed;
      } catch { /* ignore */ }
      return hotProductFallbackItems;
    })();
    return <CheckoutInlineLogin language={language} shop={shop} cartItems={displayItems} />;
  }

  if (effectiveCheckoutItems.length === 0) {
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

  // Vehicles are now auto-priced — no quote blocker needed

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

                {/* Payment Plan (30% deposit / pay in full) */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                >
                  <PaymentPlanSelector
                    value={paymentPlan}
                    onChange={setPaymentPlan}
                    totalUsd={effectiveCheckoutTotal}
                    language={language}
                    eligible={depositEligible}
                    ineligibleReason={depositIneligibleReason}
                  />
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
                    {effectiveCheckoutItems.slice(0, 3).map((item) => (
                      <div key={item.id} className="flex gap-3">
                        <img
                          src={sanitizeCartImage(item.imageUrl)}
                          alt={cleanProductText(item.title)}
                          className="w-12 h-12 rounded-lg object-contain bg-white/5"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white/80 line-clamp-1">{cleanProductText(item.title)}</p>
                          <p className="text-xs text-white/50">{shop.qty || 'Qty'}: {item.quantity}</p>
                        </div>
                      </div>
                    ))}
                    {effectiveCheckoutItems.length > 3 && (
                      <p className="text-sm text-white/50">
                        +{effectiveCheckoutItems.length - 3} {effectiveCheckoutItems.length - 3 !== 1 ? (shop.moreItems || 'more items') : (shop.moreItem || 'more item')}
                      </p>
                    )}
                  </div>

                  <PriceBreakdown 
                    itemPriceUsd={effectiveCheckoutTotal} 
                    serverTotal={orderServerTotal ?? serverTotalUsd} 
                    isFixedPrice={effectiveCheckoutItems.length > 0 && effectiveCheckoutItems.every(item => item.isFixedPrice)}
                    depositDueNowUsd={paymentPlan === 'deposit' && depositEligible
                      ? Math.ceil(effectiveCheckoutTotal * 0.30 * 100) / 100
                      : null}
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
