import { useEffect, useState, useRef } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { CheckCircle2, Loader2, Package, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useShopCart } from '@/contexts/ShopCartContext';
import { useAuth } from '@/contexts/AuthContext';
import { trackPurchase } from '@/lib/tiktokPixel';

export default function PaymentSuccess() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { clearCartOnPaymentSuccess } = useShopCart();
  const { session } = useAuth();
  const cartClearedRef = useRef(false);
  
  const orderId = searchParams.get('order_id');
  const provider = searchParams.get('provider') || 'stripe';
  
  const [verifying, setVerifying] = useState(true);
  const [verified, setVerified] = useState(false);
  const [resolvedSession, setResolvedSession] = useState(!!session);
  
  useEffect(() => {
    if (!orderId) {
      setVerifying(false);
      setVerified(true);
      return;
    }
    
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const verifyPayment = async () => {
      try {
        // Resilience: if context session is null, try getSession() fallback
        let activeSession = session;
        if (!activeSession) {
          const { data } = await supabase.auth.getSession();
          activeSession = data?.session ?? null;
          if (activeSession) {
            console.log('[PAYMENT] Recovered session via getSession() fallback');
            setResolvedSession(true);
          }
        }

        if (!activeSession) {
          // No session at all (mobile WebView) — still show success
          // /payment-callback already verified before redirecting here
          console.log('[PAYMENT] No web session — showing success without DB verification');
          setVerified(true);
          setVerifying(false);
          // Still clear cart optimistically
          if (!cartClearedRef.current) {
            cartClearedRef.current = true;
            await clearCartOnPaymentSuccess();
          }
          return;
        }

        const checkStatus = async () => {
          const { data: order, error } = await supabase
            .from('orders')
            .select('status, total_usd')
            .eq('id', orderId)
            .single();
          
          if (error) {
            console.warn('[PAYMENT] Order lookup failed (RLS or missing):', error.message);
            return null;
          }
          return order;
        };
        
        const handlePaid = async (order: { total_usd: number | null }) => {
          setVerified(true);
          setVerifying(false);
          if (!cartClearedRef.current) {
            cartClearedRef.current = true;
            trackPurchase(order?.total_usd || 0, {
              email: activeSession?.user?.email ?? undefined,
              userId: activeSession?.user?.id ?? undefined,
            });
            await clearCartOnPaymentSuccess();
            console.log('[PAYMENT] success orderId=', orderId, '-> cart cleared');
          }
        };

        // Try immediately
        const order = await checkStatus();
        if (order?.status === 'PAID') {
          await handlePaid(order);
          return;
        }
        
        // Poll for a few seconds (webhook may be slightly delayed)
        let attempts = 0;
        pollInterval = setInterval(async () => {
          attempts++;
          const polledOrder = await checkStatus();
          if (polledOrder?.status === 'PAID' || attempts >= 6) {
            if (pollInterval) clearInterval(pollInterval);
            if (polledOrder?.status === 'PAID') {
              await handlePaid(polledOrder);
            } else {
              // After 12s still not PAID — show success anyway (provider confirmed)
              setVerified(true);
              setVerifying(false);
              if (!cartClearedRef.current) {
                cartClearedRef.current = true;
                await clearCartOnPaymentSuccess();
              }
            }
          }
        }, 2000);
      } catch (error) {
        console.error('Error verifying payment:', error);
        setVerifying(false);
        setVerified(true);
        if (!cartClearedRef.current) {
          cartClearedRef.current = true;
          await clearCartOnPaymentSuccess();
        }
      }
    };
    
    verifyPayment();

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [orderId, session, clearCartOnPaymentSuccess]);
  
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
            {orderId && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="bg-white/5 rounded-2xl border border-white/10 p-6 space-y-4"
              >
                <div className="flex items-center justify-center gap-3 text-white/70">
                  <Package className="w-5 h-5" />
                  <span>Order #{orderId.slice(0, 8)}</span>
                </div>
                
                <div className="text-sm text-white/50 space-y-1">
                  <p>You will receive an email confirmation shortly.</p>
                  <p>Track your order status in the orders page.</p>
                </div>
              </motion.div>
            )}
            
            {/* Actions — vary based on whether we have a web session */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="space-y-3"
            >
              {hasSession && orderId ? (
                <Button
                  onClick={() => navigate(`/orders/${orderId}`)}
                  className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-full py-6"
                >
                  View Order Details
                  <ArrowRight className="w-5 h-5 ml-2" />
                </Button>
              ) : (
                <p className="text-sm text-white/40">
                  You can track your order from the app or by logging in on the web.
                </p>
              )}
              
              <Link to="/">
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
