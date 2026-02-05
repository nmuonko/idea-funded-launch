 import { useState, useEffect } from 'react';
 import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
 import { ArrowLeft, Loader2, CreditCard, CheckCircle2, XCircle, Lock } from 'lucide-react';
 import { motion } from 'framer-motion';
 import { ShopHeader } from '@/components/shop/ShopHeader';
 import { Button } from '@/components/ui/button';
 import { supabase } from '@/integrations/supabase/client';
 import { useToast } from '@/hooks/use-toast';
 
// Stripe promise will be loaded dynamically from backend config
let stripePromise: Promise<Stripe | null> | null = null;
let stripeLoadAttempted = false;

async function getStripePromise(): Promise<Stripe | null> {
  // Return cached instance if already loaded successfully
  if (stripePromise && stripeLoadAttempted) {
    try {
      const cached = await stripePromise;
      if (cached) {
        console.log('[CardPayment] Using cached Stripe instance');
        return cached;
      }
    } catch {
      // Cached promise failed, allow retry
      console.log('[CardPayment] Cached promise failed, retrying...');
      stripePromise = null;
    }
  }

  stripeLoadAttempted = true;

  try {
    console.log('[CardPayment] Fetching bootstrap config...');
    
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/app-bootstrap`,
      {
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
      }
    );
    
    if (!response.ok) {
      console.error('[CardPayment] Failed to fetch bootstrap config:', response.status);
      return null;
    }
    
    const data = await response.json();
    console.log('[CardPayment] Bootstrap config received');
    
    const stripeProvider = data?.payments?.providers?.find((p: any) => p.id === 'stripe');
    const publishableKey = stripeProvider?.publishable_key;
    
    if (!publishableKey) {
      console.error('[CardPayment] Stripe publishable key not found in config');
      return null;
    }
    
    console.log('[CardPayment] Loading Stripe with key:', publishableKey.substring(0, 15) + '...');
    
    // Store the promise and await it to catch any rejections
    stripePromise = loadStripe(publishableKey);
    const stripeInstance = await stripePromise;
    
    if (!stripeInstance) {
      console.error('[CardPayment] Stripe failed to initialize');
      stripePromise = null;
      return null;
    }
    
    console.log('[CardPayment] Stripe initialized successfully');
    return stripeInstance;
    
  } catch (error) {
    console.error('[CardPayment] Error loading Stripe:', error);
    stripePromise = null;
    stripeLoadAttempted = false;
    return null;
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
           return_url: `${window.location.origin}/shop/payment-success?order_id=${orderId}`,
         },
         redirect: 'if_required',
       });
       
       if (submitError) {
         setError(submitError.message || 'Payment failed');
         return;
       }
       
       if (paymentIntent?.status === 'succeeded') {
         // Payment succeeded, redirect to success page
         navigate(`/shop/payment-success?order_id=${orderId}&provider=stripe`);
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
  const [stripe, setStripe] = useState<Stripe | null>(null);
   
   useEffect(() => {
    let cancelled = false;
    
    const init = async () => {
      console.log('[CardPayment] Initializing...', { orderId, hasClientSecret: !!clientSecret });
      
      if (!orderId || !clientSecret) {
        console.error('[CardPayment] Missing orderId or clientSecret');
        setError('Invalid payment session. Please try again.');
        setLoading(false);
        return;
      }
      
      try {
        // Add timeout protection (15 seconds)
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('Initialization timeout')), 15000)
        );
        
        const stripeInstance = await Promise.race([
          getStripePromise(),
          timeoutPromise
        ]);
        
        if (cancelled) return;
        
        if (!stripeInstance) {
          setError('Failed to initialize payment. Please try again later.');
          setLoading(false);
          return;
        }
        
        setStripe(stripeInstance);
        setLoading(false);
        console.log('[CardPayment] Ready to accept payment');
        
      } catch (err: any) {
        console.error('[CardPayment] Initialization error:', err);
        if (!cancelled) {
          setError(err.message === 'Initialization timeout' 
            ? 'Payment initialization timed out. Please refresh and try again.'
            : 'Failed to initialize payment. Please try again later.');
          setLoading(false);
        }
      }
    };
    
    init();
    
    return () => { cancelled = true; };
   }, [orderId, clientSecret]);
   
   if (loading) {
     return (
       <div className="min-h-screen bg-black">
         <ShopHeader />
         <main className="pt-24 px-4 pb-20 flex items-center justify-center">
           <Loader2 className="w-8 h-8 animate-spin text-white/40" />
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
               <p className="text-white/60">{error || 'Unable to load payment form.'}</p>
               <Button
                 onClick={() => navigate('/shop/cart')}
                 className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-full"
               >
                 Back to Cart
               </Button>
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
             to="/shop/cart" 
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