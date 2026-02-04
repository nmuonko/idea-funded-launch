import { ShoppingCart, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

interface MoveAllToCartProps {
  itemCount: number;
  onMoveAll: () => void;
  loading?: boolean;
}

export function MoveAllToCart({ itemCount, onMoveAll, loading }: MoveAllToCartProps) {
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = t.shop as Record<string, string>;

  if (itemCount === 0) return null;

  return (
    <Button
      onClick={onMoveAll}
      disabled={loading}
      className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full h-12"
    >
      <ShoppingCart className="h-5 w-5 mr-2" />
      {shop.moveAllToCart || 'Move All to Cart & Checkout'}
      <ArrowRight className="h-5 w-5 ml-2" />
    </Button>
  );
}
