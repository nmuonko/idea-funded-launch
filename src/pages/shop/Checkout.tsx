import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, CreditCard, Building2, Smartphone, CheckCircle2, MapPin, Edit3 } from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { PriceBreakdown } from '@/components/shop/PriceBreakdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { useShopCart } from '@/contexts/ShopCartContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

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
  const { items, totalUsd, savePendingCheckout, restoreFromPendingCheckout } = useShopCart();
  const { user } = useAuth();
  
  const [loading, setLoading] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState('mobile_money');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
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

  // Restore cart from pending checkout if cart is empty on mount
  useEffect(() => {
    if (items.length === 0) {
      const restored = restoreFromPendingCheckout();
      if (restored) {
        console.log('[CHECKOUT] Cart restored from pending snapshot');
      }
    }
  }, []);

  // Load profile data
  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;
      
      try {
        console.log('[CHECKOUT] Loading profile for user:', user.id);
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', user.id)
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
  }, [user]);

  // Check if user has a saved address
  const hasSavedAddress = useMemo(() => {
    return !!(address.fullName && address.addressLine1 && address.city && address.country);
  }, [address]);

  const handleInputChange = (field: keyof ShippingAddress, value: string) => {
    setAddress(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!termsAccepted) {
      toast({
        title: 'Terms Required',
        description: 'Please accept the terms and conditions to continue',
        variant: 'destructive',
      });
      return;
    }

    if (items.length === 0) {
      toast({
        title: 'Empty Cart',
        description: 'Your cart is empty',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
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
        .eq('user_id', user?.id);

      // Step 1: Create/update DRAFT order from cart items
      console.log('[WEB_CHECKOUT] Step 1: Creating order from cart...');
      const { data: orderData, error: orderError } = await supabase.functions.invoke(
        'mobile-create-order-from-cart'
      );

      console.log('[WEB_CHECKOUT] Order response:', { orderData, orderError });

      if (orderError) {
        console.error('[WEB_CHECKOUT] Order creation error:', orderError);
        // Surface the actual error from backend if available
        const errorMsg = orderError.message || orderData?.message || 'Failed to prepare your order.';
        throw new Error(errorMsg);
      }

      // Check for error in response body (some errors return 200 with error object)
      if (orderData?.error) {
        console.error('[WEB_CHECKOUT] Order response error:', orderData);
        throw new Error(orderData.message || orderData.error || 'Failed to prepare your order.');
      }

      // Support both snake_case and camelCase response formats
      const orderId = orderData?.order_id || orderData?.orderId;
      const orderItemIds = orderData?.order_item_ids || orderData?.orderItemIds;

      if (!orderId || !orderItemIds) {
        console.error('[WEB_CHECKOUT] Missing order data:', orderData);
        throw new Error('Failed to create order. Please ensure your cart has items.');
      }

      console.log('[WEB_CHECKOUT] Order created:', orderId, 'items:', orderItemIds.length);

      // Step 2: Proceed to checkout with order item IDs
      console.log('[WEB_CHECKOUT] Step 2: Starting checkout...');
      
      // Build checkout payload
      // IMPORTANT: For mobile money (PawaPay), don't send payment_method_preference
      // Backend auto-routes standard orders to PawaPay when no preference is provided
      const checkoutPayload: Record<string, any> = {
        cart_item_ids: orderItemIds,
        cart_id: orderId,
      };
      
      // Only add payment_method_preference for Card or Bank Transfer
      // Mobile money is the default route when no preference is sent
      if (paymentMethod === 'card') {
        checkoutPayload.payment_method_preference = 'CARD';
      } else if (paymentMethod === 'bank_transfer') {
        checkoutPayload.payment_method_preference = 'BANK_TRANSFER';
      }
      // For 'mobile_money', we intentionally don't send payment_method_preference
      
      console.log('[WEB_CHECKOUT] Checkout payload:', checkoutPayload);
      
      const { data, error } = await supabase.functions.invoke('mobile-checkout', {
        body: checkoutPayload,
      });

      console.log('[WEB_CHECKOUT] Checkout response:', { data, error });

      if (error) {
        console.error('[WEB_CHECKOUT] Checkout error:', error);
        throw new Error(error.message || 'Checkout failed');
      }

      // Check for error in response body
      if (data?.error) {
        console.error('[WEB_CHECKOUT] Checkout response error:', data);
        throw new Error(data.message || data.error || 'Checkout failed');
      }

      // Handle different payment flows
      // Step 3: Handle awaiting_provider_selection - need to call select-payment-provider
      if (data?.status === 'awaiting_provider_selection' && data?.checkout_session_id) {
        console.log('[WEB_CHECKOUT] Step 3: Selecting payment provider...');
        
        // Map frontend payment method to provider
        const providerMap: Record<string, string> = {
          'mobile_money': 'pawapay',
          'card': 'stripe',
          'bank_transfer': 'bank_transfer',
        };
        
        const provider = providerMap[paymentMethod] || 'pawapay';
        
        const selectPayload: Record<string, any> = {
          checkout_session_id: data.checkout_session_id,
          provider,
        };
        
        // Add phone for PawaPay
        if (provider === 'pawapay' && address.phone) {
          selectPayload.phone = address.phone;
        }
        
        console.log('[WEB_CHECKOUT] Select provider payload:', selectPayload);
        
        const { data: providerData, error: providerError } = await supabase.functions.invoke(
          'select-payment-provider',
          { body: selectPayload }
        );
        
        console.log('[WEB_CHECKOUT] Provider selection response:', { providerData, providerError });
        
        if (providerError || providerData?.error) {
          console.error('[WEB_CHECKOUT] Provider selection error:', providerError || providerData);
          throw new Error(providerData?.message || providerError?.message || 'Failed to initiate payment');
        }
        
        // Handle PawaPay USSD flow - redirect to pending page
        if (providerData?.provider === 'pawapay' && providerData?.status === 'pending_user_confirmation') {
          console.log('[WEB_CHECKOUT] PawaPay USSD push initiated, redirecting to pending page');
          // Save pending checkout snapshot (cart will be cleared on payment success)
          savePendingCheckout({ 
            orderId: providerData.order_id, 
            paymentMethod: 'mobile_money',
            totalUsd 
          });
          navigate(`/payment-pending?order_id=${providerData.order_id}&provider=pawapay`);
          return;
        }
        
        // Handle Stripe redirect
        if (providerData?.provider === 'stripe' && providerData?.clientSecret) {
          // Redirect to card payment page with client secret
          console.log('[WEB_CHECKOUT] Stripe clientSecret received, redirecting to card payment page');
          // Save pending checkout snapshot (cart will be cleared on payment success)
          savePendingCheckout({ 
            orderId: providerData.order_id, 
            paymentMethod: 'card',
            totalUsd 
          });
          const cardPaymentUrl = `/card-payment?order_id=${providerData.order_id}&client_secret=${encodeURIComponent(providerData.clientSecret)}&amount=${providerData.amount || data.amount}&currency=${providerData.currency || 'USD'}`;
          navigate(cardPaymentUrl);
          return;
        }
        
        // Handle bank transfer
        if (providerData?.provider === 'bank_transfer') {
          savePendingCheckout({ 
            orderId: providerData.order_id, 
            paymentMethod: 'bank_transfer',
            totalUsd 
          });
          navigate(`/bank-transfer-info?order_id=${providerData.order_id}`);
          return;
        }
        
        // Fallback - redirect to order
        if (providerData?.order_id) {
          savePendingCheckout({ orderId: providerData.order_id, totalUsd });
          navigate(`/orders/${providerData.order_id}`);
          return;
        }
      }
      // Legacy flows (direct responses without select-payment-provider)
      else if (data?.payment_flow === 'STRIPE' && data?.clientSecret) {
        // Redirect to Stripe checkout
        savePendingCheckout({ orderId: data.order_id, paymentMethod: 'card', totalUsd });
        navigate(`/payment-callback?session_id=${data.checkout_session_id}`);
      } else if (data?.payment_flow === 'PAWAPAY' && data?.redirectUrl) {
        savePendingCheckout({ orderId: data.order_id, paymentMethod: 'mobile_money', totalUsd });
        window.location.href = data.redirectUrl;
      } else if (data?.payment_flow === 'BANK_TRANSFER') {
        savePendingCheckout({ orderId: data.order_id, paymentMethod: 'bank_transfer', totalUsd });
        navigate(`/bank-transfer-info?order_id=${data.order_id}`);
      } else if (data?.order_id) {
        savePendingCheckout({ orderId: data.order_id, totalUsd });
        navigate(`/orders/${data.order_id}`);
      }
    } catch (error: any) {
      console.error('[WEB_CHECKOUT] Error:', error);
      toast({
        title: 'Checkout Failed',
        description: error.message || 'Failed to process your order',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-black">
        <ShopHeader />
        <div className="pt-24 px-4 text-center">
          <p className="text-white/60 mb-4">Please sign in to checkout</p>
          <Link to="/shop-auth?redirect=/checkout">
            <Button className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-full">
              Sign In
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-black">
        <ShopHeader />
        <div className="pt-24 px-4 text-center">
          <p className="text-white/60 mb-4">Your cart is empty</p>
          <Link to="/browse">
            <Button className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-full">
              Continue Shopping
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black">
      <ShopHeader />

      <main className="pt-24 px-4 pb-20">
        <div className="container mx-auto max-w-4xl">
          {/* Header */}
          <Link 
            to="/cart" 
            className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-6 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Cart
          </Link>
          
          <h1 className="text-2xl font-bold text-white mb-8">Checkout</h1>

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
                  <h2 className="text-lg font-semibold text-white mb-4">Shipping Address</h2>
                  
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
                          Edit Address
                        </button>
                      </div>
                      
                      <p className="text-xs text-green-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        Using your saved shipping address
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
                          ← Back to saved address
                        </button>
                      )}
                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="fullName" className="text-white/70">Full Name</Label>
                          <Input
                            id="fullName"
                            value={address.fullName}
                            onChange={(e) => handleInputChange('fullName', e.target.value)}
                            required
                            className="mt-1 bg-white/5 border-white/10 text-white"
                          />
                        </div>
                        <div>
                          <Label htmlFor="phone" className="text-white/70">Phone Number</Label>
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
                        <Label htmlFor="addressLine1" className="text-white/70">Address Line 1</Label>
                        <Input
                          id="addressLine1"
                          value={address.addressLine1}
                          onChange={(e) => handleInputChange('addressLine1', e.target.value)}
                          required
                          className="mt-1 bg-white/5 border-white/10 text-white"
                        />
                      </div>

                      <div>
                        <Label htmlFor="addressLine2" className="text-white/70">Address Line 2 (Optional)</Label>
                        <Input
                          id="addressLine2"
                          value={address.addressLine2}
                          onChange={(e) => handleInputChange('addressLine2', e.target.value)}
                          className="mt-1 bg-white/5 border-white/10 text-white"
                        />
                      </div>

                      <div className="grid sm:grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="city" className="text-white/70">City</Label>
                          <Input
                            id="city"
                            value={address.city}
                            onChange={(e) => handleInputChange('city', e.target.value)}
                            required
                            className="mt-1 bg-white/5 border-white/10 text-white"
                          />
                        </div>
                        <div>
                          <Label htmlFor="stateProvince" className="text-white/70">State/Province</Label>
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
                          <Label htmlFor="country" className="text-white/70">Country</Label>
                          <Input
                            id="country"
                            value={address.country}
                            onChange={(e) => handleInputChange('country', e.target.value)}
                            required
                            className="mt-1 bg-white/5 border-white/10 text-white"
                          />
                        </div>
                        <div>
                          <Label htmlFor="postalCode" className="text-white/70">Postal Code (Optional)</Label>
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
                  <h2 className="text-lg font-semibold text-white mb-4">Payment Method</h2>
                  
                  <RadioGroup value={paymentMethod} onValueChange={setPaymentMethod}>
                    <div className="space-y-3">
                      <label className="flex items-center gap-4 p-4 rounded-xl border border-white/10 cursor-pointer hover:bg-white/5 transition-colors">
                        <RadioGroupItem value="mobile_money" id="mobile_money" className="border-white/40" />
                        <Smartphone className="h-5 w-5 text-white/70" />
                        <div className="flex-1">
                          <p className="text-white font-medium">Mobile Money</p>
                          <p className="text-sm text-white/50">M-Pesa, Airtel Money, Orange Money</p>
                        </div>
                      </label>

                      <label className="flex items-center gap-4 p-4 rounded-xl border border-white/10 cursor-pointer hover:bg-white/5 transition-colors">
                        <RadioGroupItem value="card" id="card" className="border-white/40" />
                        <CreditCard className="h-5 w-5 text-white/70" />
                        <div className="flex-1">
                          <p className="text-white font-medium">Credit/Debit Card</p>
                          <p className="text-sm text-white/50">Visa, Mastercard, AMEX</p>
                        </div>
                      </label>

                      <label className="flex items-center gap-4 p-4 rounded-xl border border-white/10 cursor-pointer hover:bg-white/5 transition-colors">
                        <RadioGroupItem value="bank_transfer" id="bank_transfer" className="border-white/40" />
                        <Building2 className="h-5 w-5 text-white/70" />
                        <div className="flex-1">
                          <p className="text-white font-medium">Bank Transfer</p>
                          <p className="text-sm text-white/50">Manual transfer to our bank account</p>
                        </div>
                      </label>
                    </div>
                  </RadioGroup>
                </motion.div>

                {/* Terms */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="flex items-start gap-3"
                >
                  <Checkbox
                    id="terms"
                    checked={termsAccepted}
                    onCheckedChange={(checked) => setTermsAccepted(checked as boolean)}
                    className="mt-1 border-white/40"
                  />
                  <label htmlFor="terms" className="text-sm text-white/70 cursor-pointer">
                    I agree to the{' '}
                    <Link to="/terms" className="text-blue-400 hover:underline">Terms of Service</Link>
                    {' '}and{' '}
                    <Link to="/privacy" className="text-blue-400 hover:underline">Privacy Policy</Link>
                  </label>
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
                  <h2 className="text-lg font-semibold text-white mb-4">Order Summary</h2>
                  
                  {/* Items Preview */}
                  <div className="space-y-3 mb-4 pb-4 border-b border-white/10">
                    {items.slice(0, 3).map((item) => (
                      <div key={item.id} className="flex gap-3">
                        <img
                          src={item.imageUrl || '/placeholder.svg'}
                          alt={item.title}
                          className="w-12 h-12 rounded-lg object-contain bg-white/5"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white/80 line-clamp-1">{item.title}</p>
                          <p className="text-xs text-white/50">Qty: {item.quantity}</p>
                        </div>
                      </div>
                    ))}
                    {items.length > 3 && (
                      <p className="text-sm text-white/50">
                        +{items.length - 3} more item{items.length - 3 !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                  
                  <PriceBreakdown itemPriceUsd={totalUsd} />

                  <Button
                    type="submit"
                    disabled={loading || !termsAccepted}
                    className="w-full h-12 mt-6 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Place Order
                      </>
                    )}
                  </Button>
                </motion.div>
              </div>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
