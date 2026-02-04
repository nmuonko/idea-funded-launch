import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Check } from 'lucide-react';

interface QuickAddAnimationProps {
  onAdd: () => void;
  disabled?: boolean;
  className?: string;
}

export function QuickAddAnimation({ onAdd, disabled, className }: QuickAddAnimationProps) {
  const [isAdded, setIsAdded] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (disabled || isAdded) return;
    
    setIsAdded(true);
    onAdd();
  };

  useEffect(() => {
    if (isAdded) {
      const timer = setTimeout(() => setIsAdded(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [isAdded]);

  return (
    <motion.button
      onClick={handleClick}
      disabled={disabled}
      whileTap={{ scale: 0.85 }}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
        isAdded
          ? 'bg-green-500 text-white'
          : 'bg-blue-500 hover:bg-blue-600 text-white'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
    >
      <AnimatePresence mode="wait">
        {isAdded ? (
          <motion.div
            key="check"
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Check className="h-4 w-4" />
          </motion.div>
        ) : (
          <motion.div
            key="plus"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ duration: 0.2 }}
          >
            <Plus className="h-4 w-4" />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
