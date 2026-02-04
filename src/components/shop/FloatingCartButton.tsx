import { Link } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import { motion } from 'framer-motion';
import { useShopCart } from '@/contexts/ShopCartContext';

interface FloatingCartButtonProps {
  className?: string;
}

export function FloatingCartButton({ className }: FloatingCartButtonProps) {
  const { itemCount } = useShopCart();

  if (itemCount === 0) return null;

  return (
    <Link to="/shop/cart">
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        whileHover={{ scale: 1.1 }}
        whileTap={{ scale: 0.95 }}
        className={`fixed bottom-24 right-4 md:bottom-8 z-40 ${className}`}
      >
        <div className="relative w-14 h-14 bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full shadow-lg shadow-blue-500/30 flex items-center justify-center">
          <ShoppingCart className="h-6 w-6 text-white" />
          {itemCount > 0 && (
            <span className="absolute -top-1 -right-1 h-6 min-w-[24px] flex items-center justify-center px-1.5 text-xs font-bold rounded-full bg-white text-blue-600">
              {itemCount > 99 ? '99+' : itemCount}
            </span>
          )}
        </div>
      </motion.div>
    </Link>
  );
}
