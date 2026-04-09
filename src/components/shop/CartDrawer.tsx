import { Link } from 'react-router-dom';
import { ShoppingCart, Plus, Minus, Trash2, Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useShopCart } from '@/contexts/ShopCartContext';
import { allInclusivePrice } from '@/lib/allInclusivePrice';
import { sanitizeCartImage } from '@/lib/imageValidation';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';
import { cn } from '@/lib/utils';

interface CartDrawerProps {
  className?: string;
}

export function CartDrawer({ className }: CartDrawerProps) {
  const { items, itemCount, totalUsd, loading, updateQuantity, removeItem, feeSettings } = useShopCart();
  const { language } = useLanguage();
  
  const t = translations[language] || translations.en;
  const shop = t.shop;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "relative text-white/70 hover:text-white hover:bg-white/10 rounded-full",
            className
          )}
        >
          <ShoppingCart className="h-5 w-5" />
          {itemCount > 0 && (
            <Badge 
              className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-xs bg-gradient-to-r from-blue-500 to-cyan-500 border-0"
            >
              {itemCount > 99 ? '99+' : itemCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      
      <SheetContent className="w-full sm:max-w-md bg-black/95 backdrop-blur-xl border-white/10">
        <SheetHeader>
          <SheetTitle className="text-white flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            {shop.yourCart}
            {itemCount > 0 && (
              <Badge variant="secondary" className="bg-white/10 text-white/70">
                {itemCount} {itemCount === 1 ? shop.item : shop.items}
              </Badge>
            )}
          </SheetTitle>
        </SheetHeader>

        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-white/40" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <ShoppingCart className="h-16 w-16 text-white/20 mb-4" />
            <p className="text-white/60 mb-4">{shop.emptyCart}</p>
            <Link to="/">
              <Button className="bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-full">
                {shop.startShopping}
              </Button>
            </Link>
          </div>
        ) : (
          <>
            <ScrollArea className="flex-1 mt-6 -mx-6 px-6" style={{ height: 'calc(100vh - 280px)' }}>
              <div className="space-y-4">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="flex gap-3 p-3 bg-white/5 rounded-xl border border-white/10"
                  >
                    {/* Image */}
                    <div className="w-20 h-20 rounded-lg overflow-hidden bg-white/5 flex-shrink-0">
                      <img
                        src={sanitizeCartImage(item.imageUrl)}
                        alt={item.title}
                        className="w-full h-full object-contain p-1"
                      />
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-white/90 line-clamp-2 mb-1">
                        {item.title}
                      </h4>
                      <p className="text-sm font-bold text-white mb-2">
                        ${item.priceUsd.toFixed(2)}
                      </p>
                      
                      {/* Quantity Controls */}
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => updateQuantity(item.id, item.quantity - 1)}
                          className="h-7 w-7 p-0 text-white/60 hover:text-white hover:bg-white/10 rounded-full"
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="text-sm text-white/90 w-6 text-center">
                          {item.quantity}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => updateQuantity(item.id, item.quantity + 1)}
                          className="h-7 w-7 p-0 text-white/60 hover:text-white hover:bg-white/10 rounded-full"
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                        
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeItem(item.id)}
                          className="h-7 w-7 p-0 ml-auto text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-full"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            {/* Footer */}
            <div className="mt-6 space-y-4 border-t border-white/10 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-white/60">{shop.subtotal}</span>
                <span className="text-lg font-bold text-white">
                  ${items.reduce((sum, i) => sum + i.priceUsd * i.quantity, 0).toFixed(2)}
                </span>
              </div>
              <p className="text-xs text-white/40">
                {shop.shippingNote}
              </p>
              
              <div className="flex gap-2">
                <Link to="/cart" className="flex-1">
                  <Button 
                    variant="outline" 
                    className="w-full border-white/20 text-white hover:bg-white/10 rounded-full"
                  >
                    {shop.viewCart}
                  </Button>
                </Link>
                <Link to="/checkout" className="flex-1">
                  <Button className="w-full bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full">
                    {shop.checkout}
                  </Button>
                </Link>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
