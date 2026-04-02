import { Link } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useShopCart } from '@/contexts/ShopCartContext';
import { allInclusivePrice } from '@/lib/allInclusivePrice';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@/components/ui/hover-card';

export function MiniCartPreview() {
  const { items, itemCount, totalUsd, exchangeRate } = useShopCart();
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = t.shop as Record<string, string>;

  const previewItems = items.slice(0, 3);
  const remainingCount = items.length - 3;

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Link to="/shop/cart">
          <Button
            variant="ghost"
            size="sm"
            className="relative text-white/70 hover:text-white hover:bg-white/10 rounded-full p-2"
          >
            <ShoppingCart className="h-5 w-5" />
            {itemCount > 0 && (
              <span className="absolute -top-1 -right-1 h-5 min-w-[20px] flex items-center justify-center px-1 text-xs font-bold rounded-full bg-blue-500 text-white">
                {itemCount > 99 ? '99+' : itemCount}
              </span>
            )}
          </Button>
        </Link>
      </HoverCardTrigger>
      
      <HoverCardContent 
        align="end" 
        className="w-80 bg-black/95 border-white/10 backdrop-blur-xl p-0 hidden md:block"
      >
        {items.length === 0 ? (
          <div className="p-6 text-center">
            <ShoppingCart className="h-12 w-12 text-white/20 mx-auto mb-3" />
            <p className="text-white/60 text-sm">
              {shop.emptyCart || 'Your cart is empty'}
            </p>
            <Link to="/shop">
              <Button 
                size="sm" 
                className="mt-4 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-full"
              >
                {shop.startShopping || 'Start Shopping'}
              </Button>
            </Link>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="p-4 border-b border-white/10">
              <h3 className="text-white font-semibold">
                {shop.yourCart || 'Your Cart'} ({itemCount} {itemCount === 1 ? 'item' : 'items'})
              </h3>
            </div>

            {/* Items */}
            <div className="p-4 space-y-3 max-h-64 overflow-y-auto">
              {previewItems.map((item) => (
                <div key={item.id} className="flex gap-3">
                  <img
                    src={item.imageUrl || '/placeholder.svg'}
                    alt={item.title}
                    className="w-12 h-12 rounded-lg object-contain bg-white/5"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white/80 line-clamp-1">{item.title}</p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-white/50">Qty: {item.quantity}</span>
                      <span className="text-sm text-white font-medium">
                        ${(item.priceUsd * item.quantity).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              {remainingCount > 0 && (
                <p className="text-sm text-white/50 text-center">
                  +{remainingCount} more {remainingCount === 1 ? 'item' : 'items'}
                </p>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-white/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-white/60">{shop.subtotal || 'Subtotal'}:</span>
                <div className="text-right">
                  <span className="text-white font-bold">${totalUsd.toFixed(2)}</span>
                  <span className="text-white/50 text-xs block">
                    ≈ CDF {(totalUsd * exchangeRate).toLocaleString()}
                  </span>
                </div>
              </div>
              
              <div className="flex gap-2">
                <Link to="/shop/cart" className="flex-1">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full border-white/20 text-white hover:bg-white/10 rounded-full"
                  >
                    {shop.viewCart || 'View Cart'}
                  </Button>
                </Link>
                <Link to="/shop/checkout" className="flex-1">
                  <Button 
                    size="sm" 
                    className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-full"
                  >
                    {shop.checkout || 'Checkout'}
                  </Button>
                </Link>
              </div>
            </div>
          </>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
