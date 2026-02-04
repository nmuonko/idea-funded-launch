import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, ArrowRight, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

interface PaymentResultProps {
  success: boolean;
  orderId?: string;
  errorMessage?: string;
  onRetry?: () => void;
}

export function PaymentResult({ success, orderId, errorMessage, onRetry }: PaymentResultProps) {
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = t.shop as Record<string, string>;

  if (success) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
          className="w-24 h-24 bg-green-500/20 rounded-full flex items-center justify-center mb-6"
        >
          <CheckCircle2 className="h-12 w-12 text-green-400" />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-2xl font-bold text-white mb-2"
        >
          {shop.paymentSuccessful || 'Payment Successful!'}
        </motion.h1>

        {orderId && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-white/60 mb-2"
          >
            {shop.orderNumber || 'Order'} #{orderId}
          </motion.p>
        )}

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-white/50 text-sm mb-8 max-w-sm"
        >
          {shop.paymentSuccessMessage || "We'll email you confirmation and tracking updates."}
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="flex flex-col sm:flex-row gap-3 w-full max-w-sm"
        >
          <Link to={`/shop/orders`} className="flex-1">
            <Button className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-full">
              {shop.viewOrder || 'View Order'}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
          <Link to="/shop" className="flex-1">
            <Button variant="outline" className="w-full border-white/20 text-white hover:bg-white/10 rounded-full">
              {shop.keepShopping || 'Keep Shopping'}
            </Button>
          </Link>
        </motion.div>

        {/* What happens next */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="mt-12 bg-white/5 border border-white/10 rounded-xl p-6 max-w-sm w-full"
        >
          <h3 className="text-white font-semibold mb-4">{shop.whatHappensNext || 'What happens next'}</h3>
          <ul className="space-y-3 text-left">
            <li className="flex items-start gap-3">
              <span className="text-blue-400 font-bold">1.</span>
              <span className="text-white/70 text-sm">{shop.step1Next || 'We purchase your items from US stores'}</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-400 font-bold">2.</span>
              <span className="text-white/70 text-sm">{shop.step2Next || 'Items ship to our warehouse'}</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="text-blue-400 font-bold">3.</span>
              <span className="text-white/70 text-sm">{shop.step3Next || 'We ship to DRC (10-17 days)'}</span>
            </li>
          </ul>
        </motion.div>
      </div>
    );
  }

  // Failed state
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 15 }}
        className="w-24 h-24 bg-red-500/20 rounded-full flex items-center justify-center mb-6"
      >
        <XCircle className="h-12 w-12 text-red-400" />
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-2xl font-bold text-white mb-2"
      >
        {shop.paymentFailed || 'Payment Failed'}
      </motion.h1>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-white/60 mb-8 max-w-sm"
      >
        {errorMessage || shop.paymentFailedMessage || 'Your payment was declined. Please try another method.'}
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="flex flex-col sm:flex-row gap-3 w-full max-w-sm"
      >
        {onRetry && (
          <Button
            onClick={onRetry}
            className="flex-1 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-full"
          >
            {shop.tryAgain || 'Try Again'}
          </Button>
        )}
        <a href="https://wa.me/243973141627" target="_blank" rel="noopener noreferrer" className="flex-1">
          <Button variant="outline" className="w-full border-white/20 text-white hover:bg-white/10 rounded-full">
            <MessageCircle className="h-4 w-4 mr-2" />
            {shop.contactSupport || 'Contact Support'}
          </Button>
        </a>
      </motion.div>
    </div>
  );
}
