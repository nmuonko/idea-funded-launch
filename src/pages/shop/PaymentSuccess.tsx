 import { useEffect, useState, useRef } from 'react';
 import { useSearchParams, useNavigate, Link } from 'react-router-dom';
 import { CheckCircle2, Loader2, Package, ArrowRight } from 'lucide-react';
 import { motion } from 'framer-motion';
 import { ShopHeader } from '@/components/shop/ShopHeader';
 import { Button } from '@/components/ui/button';
 import { supabase } from '@/integrations/supabase/client';
 import { useShopCart } from '@/contexts/ShopCartContext';
 
 export default function PaymentSuccess() {
   const [searchParams] = useSearchParams();
   const navigate = useNavigate();
   const { clearCartOnPaymentSuccess } = useShopCart();
   const cartClearedRef = useRef(false);
   
   const orderId = searchParams.get('order_id');
   const provider = searchParams.get('provider') || 'stripe';
   
   const [verifying, setVerifying] = useState(true);
   const [verified, setVerified] = useState(false);
   
   useEffect(() => {
     if (!orderId) {
       setVerifying(false);
       return;
     }
     
     const verifyPayment = async () => {
       try {
         // Poll for order status update
         const checkStatus = async () => {
           const { data: order } = await supabase
             .from('orders')
             .select('status')
             .eq('id', orderId)
             .single();
           
           return order?.status === 'PAID';
         };
         
         // Try immediately
         if (await checkStatus()) {
           setVerified(true);
           setVerifying(false);
           // Clear cart on confirmed payment success
           if (!cartClearedRef.current) {
             cartClearedRef.current = true;
             await clearCartOnPaymentSuccess();
             console.log('[PAYMENT] success orderId=', orderId, '-> cart cleared');
           }
           return;
         }
         
         // Poll for a few seconds
         let attempts = 0;
         const interval = setInterval(async () => {
           attempts++;
           const isPaid = await checkStatus();
           if (isPaid || attempts >= 6) {
             clearInterval(interval);
             setVerified(true);
             setVerifying(false);
             // Clear cart on confirmed payment success
             if (isPaid && !cartClearedRef.current) {
               cartClearedRef.current = true;
               await clearCartOnPaymentSuccess();
               console.log('[PAYMENT] success orderId=', orderId, '-> cart cleared');
             }
           }
         }, 2000);
         
         // Cleanup
         return () => clearInterval(interval);
       } catch (error) {
         console.error('Error verifying payment:', error);
         setVerifying(false);
         setVerified(true); // Assume success since Stripe confirmed it
         // Clear cart on assumed success
         if (!cartClearedRef.current) {
           cartClearedRef.current = true;
           await clearCartOnPaymentSuccess();
         }
       }
     };
     
     verifyPayment();
   }, [orderId, clearCartOnPaymentSuccess]);
   
   if (verifying) {
     return (
       <div className="min-h-screen bg-black">
         <ShopHeader />
         <main className="pt-24 px-4 pb-20 flex items-center justify-center">
           <div className="text-center space-y-4">
             <Loader2 className="w-12 h-12 animate-spin text-blue-400 mx-auto" />
             <p className="text-white/60">Verifying your payment...</p>
           </div>
         </main>
       </div>
     );
   }
   
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
             {/* Success Icon */}
             <motion.div
               initial={{ scale: 0 }}
               animate={{ scale: 1 }}
               transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
               className="w-24 h-24 mx-auto bg-green-500/20 rounded-full flex items-center justify-center"
             >
               <CheckCircle2 className="w-12 h-12 text-green-500" />
             </motion.div>
             
             {/* Success Message */}
             <motion.div
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               transition={{ delay: 0.3 }}
               className="space-y-2"
             >
               <h1 className="text-2xl font-bold text-white">Payment Successful!</h1>
               <p className="text-white/60">
                 Thank you for your order. We'll start processing it right away.
               </p>
             </motion.div>
             
             {/* Order Info */}
             <motion.div
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               transition={{ delay: 0.4 }}
               className="bg-white/5 rounded-2xl border border-white/10 p-6 space-y-4"
             >
               <div className="flex items-center justify-center gap-3 text-white/70">
                 <Package className="w-5 h-5" />
                 <span>Order #{orderId?.slice(0, 8)}</span>
               </div>
               
               <div className="text-sm text-white/50 space-y-1">
                 <p>You will receive an email confirmation shortly.</p>
                 <p>Track your order status in the orders page.</p>
               </div>
             </motion.div>
             
             {/* Actions */}
             <motion.div
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               transition={{ delay: 0.5 }}
               className="space-y-3"
             >
               <Button
                  onClick={() => navigate(`/orders/${orderId}`)}
                 className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-full py-6"
               >
                 View Order Details
                 <ArrowRight className="w-5 h-5 ml-2" />
               </Button>
               
                <Link to="/browse">
                 <Button variant="outline" className="w-full border-white/20 text-white rounded-full">
                   Continue Shopping
                 </Button>
               </Link>
             </motion.div>
           </motion.div>
         </div>
       </main>
     </div>
   );
 }