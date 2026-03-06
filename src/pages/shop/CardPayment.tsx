 import { useState, useEffect } from 'react';
 import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { ArrowLeft, Loader2, CreditCard, CheckCircle2, XCircle, Lock, RefreshCw } from 'lucide-react';
 import { motion } from 'framer-motion';
 import { ShopHeader } from '@/components/shop/ShopHeader';
 import { Button } from '@/components/ui/button';
 import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/integrations/supabase/client';
 import { useToast } from '@/hooks/use-toast';
 
// Stripe instance cache with proper retry handling
let cachedStripeInstance: Stripe | null = null;
let lastLoadAttempt = 0;
const RETRY_DELAY_MS = 3000; // Minimum 3s between retries

async function getStripePromise(forceReload = false): Promise<Stripe | null> {
  // Return cached instance if valid and not forcing reload
  if (cachedStripeInstance && !forceReload) {
    console.log('[CardPayment] Using cached Stripe instance');
    return cachedStripeInstance;
  }

  // Prevent rapid retry attempts
  const now = Date.now();
  if (now - lastLoadAttempt < RETRY_DELAY_MS && !forceReload) {
    console.log('[CardPayment] Too soon to retry, waiting...');
    return null;
  }
  lastLoadAttempt = now;

  try {
    console.log('[CardPayment] Fetching bootstrap config...');
    
    // Use AbortController for proper timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    try {
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/app-bootstrap`,
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Content-Type': 'application/json',
          },
          signal: controller.signal,
        },
      );
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        console.error('[CardPayment] Bootstrap config failed:', response.status, response.statusText);
        throw new Error(`Config fetch failed: ${response.status}`);
      }
      
      const data = await response.json();
      console.log('[CardPayment] Bootstrap config received:', { 
        hasPayments: !!data?.payments,
        providersCount: data?.payments?.providers?.length 
      });
      
      const stripeProvider = data?.payments?.providers?.find((p: any) => p.id === 'stripe');
      const publishableKey = stripeProvider?.publishable_key;
      
      if (!publishableKey) {
        console.error('[CardPayment] Stripe publishable key not found in config');
        throw new Error('Stripe not configured');
      }
      
      console.log('[CardPayment] Loading Stripe with key:', publishableKey.substring(0, 15) + '...');
      
      const stripeInstance = await loadStripe(publishableKey);
      
      if (!stripeInstance) {
        console.error('[CardPayment] Stripe.js failed to initialize');
        throw new Error('Stripe.js failed to load');
      }
      
      console.log('[CardPayment] Stripe initialized successfully');
      cachedStripeInstance = stripeInstance;
      return stripeInstance;
      
    } catch (fetchError: any) {
      clearTimeout(timeoutId);
      if (fetchError.name === 'AbortError') {
        throw new Error('Network timeout - please check your connection');
      }
      throw fetchError;
    }
    
  } catch (error) {
    console.error('[CardPayment] Error loading Stripe:', error);
    throw error;
  }
}
 
 function PaymentForm({ orderId, amount, currency }: { orderId: string; amount: number; currency: string }) {
   const stripe = useStripe();
   const elements = useElements();
   const navigate = useNavigate();
   const { toast } = useToast();
   
   const [loading, setLoading] = useState(false);
   const [error, setError] = useState<string | null>(null);
   
   const handleSubmit = async (e: React.FormEvent) => {
     e.preventDefault();
     
     if (!stripe || !elements) {
       return;
     }
     
     setLoading(true);
     setError(null);
     
     try {
       const { error: submitError, paymentIntent } = await stripe.confirmPayment({
         elements,
         confirmParams: {
           return_url: `${window.location.origin}/payment-success-shop?order_id=${orderId}`,
         },
         redirect: 'if_required',
       });
       
       if (submitError) {
         setError(submitError.message || 'Payment failed');
         return;
       }
       
       if (paymentIntent?.status === 'succeeded') {
         // Payment succeeded, redirect to success page
         navigate(`/payment-success-shop?order_id=${orderId}&provider=stripe`);
       } else if (paymentIntent?.status === 'requires_action') {
         // 3D Secure or other action needed - Stripe will handle redirect
       } else {
         // Unexpected status
         toast({
           title: 'Payment Processing',
           description: 'Your payment is being processed. Check your orders for status.',
         });
         navigate(`/shop/orders/${orderId}`);
       }
     } catch (err: any) {
       console.error('Payment error:', err);
       setError(err.message || 'An unexpected error occurred');
     } finally {
       setLoading(false);
     }
   };
   
   return (
     <form onSubmit={handleSubmit} className="space-y-6">
       <div className="bg-white/5 rounded-xl p-4 border border-white/10">
         <PaymentElement 
           options={{
             layout: 'tabs',
           }}
         />
       </div>
       
       {error && (
         <motion.div
           initial={{ opacity: 0, y: -10 }}
           animate={{ opacity: 1, y: 0 }}
           className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center"
         >
           <p className="text-red-400">{error}</p>
         </motion.div>
       )}
       
       <div className="space-y-4">
         <Button
           type="submit"
           disabled={!stripe || loading}
           className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-full py-6 text-lg font-semibold"
         >
           {loading ? (
             <>
               <Loader2 className="w-5 h-5 mr-2 animate-spin" />
               Processing...
             </>
           ) : (
             <>
               <Lock className="w-5 h-5 mr-2" />
               Pay ${amount.toFixed(2)} {currency}
             </>
           )}
         </Button>
         
         <div className="flex items-center justify-center gap-2 text-white/50 text-sm">
           <Lock className="w-4 h-4" />
           <span>Secured by Stripe</span>
         </div>
       </div>
     </form>
   );
 }
 
 export default function CardPayment() {
   const [searchParams] = useSearchParams();
   const navigate = useNavigate();
   
   const orderId = searchParams.get('order_id');
   const clientSecret = searchParams.get('client_secret');
   const amount = parseFloat(searchParams.get('amount') || '0');
   const currency = searchParams.get('currency') || 'USD';
   
   const [loading, setLoading] = useState(true);
   const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [stripe, setStripe] = useState<Stripe | null>(null);
   
  const initializeStripe = async (forceReload = false) => {
    console.log('[CardPayment] Initializing...', { orderId, hasClientSecret: !!clientSecret, forceReload });
    
    if (!orderId || !clientSecret) {
      console.error('[CardPayment] Missing orderId or clientSecret');
      setError('Invalid payment session');
      setErrorDetails('Missing order or payment information. Please try again from your cart.');
      setLoading(false);
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      setErrorDetails(null);
      
      const stripeInstance = await getStripePromise(forceReload);
      
      if (!stripeInstance) {
        throw new Error('Could not initialize payment system');
      }
      
      setStripe(stripeInstance);
      setLoading(false);
      console.log('[CardPayment] Ready to accept payment');
      
    } catch (err: any) {
      console.error('[CardPayment] Initialization error:', err);
      setError('Payment initialization failed');
      setErrorDetails(err.message || 'Please check your internet connection and try again.');
      setLoading(false);
    }
  };
  
  const handleRetry = async () => {
    setRetrying(true);
    await initializeStripe(true);
    setRetrying(false);
  };
  
   useEffect(() => {
    initializeStripe(false);
   }, [orderId, clientSecret]);
   
   if (loading) {
     return (
       <div className="min-h-screen bg-black">
         <ShopHeader />
        <main className="pt-24 px-4 pb-20 flex flex-col items-center justify-center min-h-[60vh]">
          <Loader2 className="w-10 h-10 animate-spin text-blue-400 mb-4" />
          <p className="text-white/60 text-sm">Initializing secure payment...</p>
         </main>
       </div>
     );
   }
   
   if (error || !clientSecret || !orderId) {
     return (
       <div className="min-h-screen bg-black">
         <ShopHeader />
         <main className="pt-24 px-4 pb-20">
           <div className="container mx-auto max-w-md">
             <motion.div
               initial={{ opacity: 0, scale: 0.9 }}
               animate={{ opacity: 1, scale: 1 }}
               className="text-center space-y-6"
             >
               <div className="w-20 h-20 mx-auto bg-red-500/20 rounded-full flex items-center justify-center">
                 <XCircle className="w-10 h-10 text-red-500" />
               </div>
               <h1 className="text-2xl font-bold text-white">Payment Error</h1>
              <div className="space-y-2">
                <p className="text-white/60">{error || 'Unable to load payment form.'}</p>
                {errorDetails && (
                  <p className="text-white/40 text-sm">{errorDetails}</p>
                )}
              </div>
              <div className="flex flex-col gap-3">
                {/* Retry button - only show if we have valid session params */}
                {orderId && clientSecret && (
                  <Button
                    onClick={handleRetry}
                    disabled={retrying}
                    variant="outline"
                    className="w-full border-white/20 text-white hover:bg-white/10 rounded-full"
                  >
                    {retrying ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="w-4 h-4 mr-2" />
                    )}
                    Try Again
                  </Button>
                )}
                <Button
                  onClick={() => navigate('/cart')}
                  className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-full"
                >
                  Back to Cart
                </Button>
              </div>
             </motion.div>
           </div>
         </main>
       </div>
     );
   }
   
   const stripeOptions = {
     clientSecret,
     appearance: {
       theme: 'night' as const,
       variables: {
         colorPrimary: '#3b82f6',
         colorBackground: '#0a0a0a',
         colorText: '#ffffff',
         colorDanger: '#ef4444',
         fontFamily: 'system-ui, sans-serif',
         borderRadius: '12px',
       },
     },
   };
   
   return (
     <div className="min-h-screen bg-black">
       <ShopHeader />
       
       <main className="pt-24 px-4 pb-20">
         <div className="container mx-auto max-w-md">
           <Link 
              to="/cart" 
             className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-6 transition-colors"
           >
             <ArrowLeft className="h-4 w-4" />
             Back to Cart
           </Link>
           
           <motion.div
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             className="bg-white/5 rounded-2xl border border-white/10 p-6 space-y-6"
           >
             {/* Header */}
             <div className="text-center space-y-2">
               <div className="w-16 h-16 mx-auto bg-gradient-to-br from-blue-500/20 to-cyan-500/20 rounded-full flex items-center justify-center">
                 <CreditCard className="w-8 h-8 text-blue-400" />
               </div>
               <h1 className="text-xl font-bold text-white">Complete Payment</h1>
               <p className="text-white/60">Enter your card details below</p>
             </div>
             
             {/* Amount Display */}
             <div className="bg-white/5 rounded-xl p-4 text-center">
               <p className="text-sm text-white/50">Total Amount</p>
               <p className="text-3xl font-bold text-white">${amount.toFixed(2)} <span className="text-lg text-white/60">{currency}</span></p>
             </div>
             
             {/* Stripe Elements */}
      <Elements stripe={stripe} options={stripeOptions}>
               <PaymentForm orderId={orderId} amount={amount} currency={currency} />
             </Elements>
           </motion.div>
         </div>
       </main>
     </div>
   );
 }