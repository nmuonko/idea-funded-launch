 import { useState, useEffect, useRef } from 'react';
 import { Link, useSearchParams, useNavigate } from 'react-router-dom';
 import { Smartphone, Loader2, CheckCircle2, XCircle, ArrowLeft, RefreshCw } from 'lucide-react';
 import { motion } from 'framer-motion';
 import { ShopHeader } from '@/components/shop/ShopHeader';
 import { Button } from '@/components/ui/button';
 import { supabase } from '@/integrations/supabase/client';
 import { useShopCart } from '@/contexts/ShopCartContext';
 
 export default function PaymentPending() {
   const [searchParams] = useSearchParams();
   const navigate = useNavigate();
   const { clearCartOnPaymentSuccess, clearPendingCheckout, exchangeRate } = useShopCart();
   const cartClearedRef = useRef(false);
   const orderId = searchParams.get('order_id');
   const provider = searchParams.get('provider') || 'pawapay';
   
   const [status, setStatus] = useState<'pending' | 'paid' | 'failed'>('pending');
   const [loading, setLoading] = useState(false);
   const [checkCount, setCheckCount] = useState(0);
   const [orderAmount, setOrderAmount] = useState<{ usd: number; cdf: number } | null>(null);
   
   // Poll for payment status
   useEffect(() => {
     if (!orderId || status !== 'pending') return;
     
     const checkStatus = async () => {
       try {
         const { data: order } = await supabase
           .from('orders')
           .select('status, total_usd, total_cdf')
           .eq('id', orderId)
           .single();
         
         // Set order amount on first fetch
         if (order && !orderAmount) {
           setOrderAmount({
             usd: order.total_usd || 0,
             cdf: order.total_cdf || 0,
           });
         }
         
         if (order?.status === 'PAID') {
           setStatus('paid');
           // Clear cart on confirmed payment success
           if (!cartClearedRef.current) {
             cartClearedRef.current = true;
             await clearCartOnPaymentSuccess();
             console.log('[PAYMENT] success orderId=', orderId, '-> cart cleared');
           }
        } else if (order?.status === 'DRAFT') {
          // Order was reset/cancelled - treat as failed
           setStatus('failed');
           // Keep cart (don't clear), just clear pending snapshot
           clearPendingCheckout();
         }
         setCheckCount(prev => prev + 1);
       } catch (error) {
         console.error('Error checking payment status:', error);
       }
     };
     
     // Check immediately
     checkStatus();
     
     // Then poll every 5 seconds for up to 2 minutes
     const interval = setInterval(() => {
       if (checkCount < 24) {
         checkStatus();
       }
     }, 5000);
     
     return () => clearInterval(interval);
   }, [orderId, status, checkCount, clearCartOnPaymentSuccess, clearPendingCheckout, orderAmount]);
   
   const handleRetry = async () => {
     if (!orderId) return;
     setLoading(true);
     
     try {
       const { data, error } = await supabase.functions.invoke('mobile-retry-payment', {
         body: { order_id: orderId },
       });
       
       if (error || data?.error) {
         throw new Error(data?.message || error?.message || 'Retry failed');
       }
       
       // Reset to pending state
       setStatus('pending');
       setCheckCount(0);
     } catch (error: any) {
       console.error('Retry error:', error);
     } finally {
       setLoading(false);
     }
   };
   
   if (status === 'paid') {
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
               <div className="w-20 h-20 mx-auto bg-green-500/20 rounded-full flex items-center justify-center">
                 <CheckCircle2 className="w-10 h-10 text-green-500" />
               </div>
               <h1 className="text-2xl font-bold text-white">Payment Successful!</h1>
               <p className="text-white/60">
                 Your payment has been confirmed. We'll start processing your order right away.
               </p>
               <Button
                  onClick={() => navigate(`/orders/${orderId}`)}
                 className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-full"
               >
                 View Order
               </Button>
             </motion.div>
           </div>
         </main>
       </div>
     );
   }
   
   if (status === 'failed') {
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
               <h1 className="text-2xl font-bold text-white">Payment Failed</h1>
               <p className="text-white/60">
                 The payment was not completed. You can try again or choose a different payment method.
               </p>
               <div className="flex flex-col gap-3">
                 <Button
                   onClick={handleRetry}
                   disabled={loading}
                   className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-full"
                 >
                   {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                   Try Again
                 </Button>
                  <Link to="/checkout">
                   <Button variant="outline" className="w-full border-white/20 text-white rounded-full">
                     Back to Checkout
                   </Button>
                 </Link>
               </div>
             </motion.div>
           </div>
         </main>
       </div>
     );
   }
   
   // Pending state - show USSD confirmation message
   return (
     <div className="min-h-screen bg-black">
       <ShopHeader />
       <main className="pt-24 px-4 pb-20">
         <div className="container mx-auto max-w-md">
           <Link 
              to="/my-orders" 
             className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-6 transition-colors"
           >
             <ArrowLeft className="h-4 w-4" />
             Back to Orders
           </Link>
           
           <motion.div
             initial={{ opacity: 0, y: 20 }}
             animate={{ opacity: 1, y: 0 }}
             className="bg-white/5 rounded-2xl border border-white/10 p-8 text-center space-y-6"
           >
             {/* Animated phone icon */}
             <motion.div
               animate={{ 
                 scale: [1, 1.05, 1],
                 opacity: [1, 0.8, 1]
               }}
               transition={{ 
                 duration: 2,
                 repeat: Infinity,
                 ease: "easeInOut"
               }}
               className="w-24 h-24 mx-auto bg-gradient-to-br from-blue-500/20 to-cyan-500/20 rounded-full flex items-center justify-center"
             >
               <Smartphone className="w-12 h-12 text-blue-400" />
             </motion.div>
             
              <div className="space-y-2">
                <h1 className="text-2xl font-bold text-white">Check Your Phone</h1>
                <p className="text-lg text-yellow-400 font-medium">
                  A payment request has been sent to your mobile phone
                </p>
              </div>
              
              {/* Amount Display */}
              {orderAmount && (
                <div className="bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border border-blue-500/30 rounded-xl p-4">
                  <p className="text-white/60 text-sm mb-1">Amount to pay</p>
                  <p className="text-3xl font-bold text-white">
                    ${orderAmount.usd.toFixed(2)} <span className="text-lg font-normal text-white/50">USD</span>
                  </p>
                  <p className="text-lg text-cyan-400 font-medium mt-1">
                    ≈ CDF {orderAmount.cdf.toLocaleString()}
                  </p>
                </div>
              )}
              
              <div className="bg-white/5 rounded-xl p-4 space-y-3">
                <p className="text-white/80">
                  Please check your phone for the <span className="text-cyan-400 font-semibold">USSD prompt</span> and enter your PIN to confirm the payment.
                </p>
                <p className="text-white/60 text-sm">
                  The request will expire in a few minutes. If you don't see it, check your mobile money app.
                </p>
              </div>
             
             {/* Loading indicator */}
             <div className="flex items-center justify-center gap-3 text-white/50">
               <Loader2 className="w-5 h-5 animate-spin" />
               <span>Waiting for confirmation...</span>
             </div>
             
             {/* Progress dots */}
             <div className="flex justify-center gap-2">
               {[0, 1, 2].map((i) => (
                 <motion.div
                   key={i}
                   animate={{ 
                     opacity: [0.3, 1, 0.3],
                     scale: [0.8, 1, 0.8]
                   }}
                   transition={{ 
                     duration: 1.5,
                     repeat: Infinity,
                     delay: i * 0.3
                   }}
                   className="w-2 h-2 bg-blue-400 rounded-full"
                 />
               ))}
             </div>
             
             <div className="pt-4 border-t border-white/10">
               <p className="text-sm text-white/40">
                 Having trouble? Contact support via WhatsApp
               </p>
             </div>
           </motion.div>
         </div>
       </main>
     </div>
   );
 }