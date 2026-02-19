import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingCart, Check, Loader2, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useShopCart } from '@/contexts/ShopCartContext';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

export interface Product {
  id: string;
  provider: string;
  title: string;
  imageUrl: string;
  priceUsd: number;
  rating?: number;
  inStock?: boolean;
  productUrl?: string;
}

interface ProductCardProps {
  product: Product;
  className?: string;
  compact?: boolean;
}

export function ProductCard({ product, className, compact = false }: ProductCardProps) {
  const { addItem, addToSaved, removeFromSaved, isItemSaved, exchangeRate } = useShopCart();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = (t.shop || {}) as any;

  const isSaved = isItemSaved(product.id, product.provider);

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    setAdding(true);
    try {
      await addItem({
        productId: product.id,
        provider: product.provider,
        title: product.title,
        imageUrl: product.imageUrl,
        priceUsd: product.priceUsd,
        quantity: 1,
        productUrl: product.productUrl,
      });
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    } finally {
      setAdding(false);
    }
  };

  const handleToggleSaved = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (isSaved) {
      removeFromSaved(product.id);
    } else {
      addToSaved({
        productId: product.id,
        provider: product.provider,
        title: product.title,
        imageUrl: product.imageUrl,
        priceUsd: product.priceUsd,
        productUrl: product.productUrl,
      });
    }
  };

  const normalizedProvider = product.provider?.toLowerCase() === 'rainforest' ? 'amazon' : product.provider;
  const providerColor = normalizedProvider === 'amazon'
    ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    : 'bg-blue-500/20 text-blue-400 border-blue-500/30';

  const getProviderDisplayName = (provider: string): string => {
    const normalized = provider.toLowerCase();
    if (normalized === 'rainforest' || normalized === 'amazon') return 'Amazon';
    if (normalized === 'ebay') return 'eBay';
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  };

  const getProductIdForUrl = (): string => {
    const id = product.id;
    if (id.toLowerCase().startsWith('amazon_')) return id.slice(7);
    if (id.toLowerCase().startsWith('rainforest_')) return id.slice(11);
    if (id.toLowerCase().startsWith('ebay_')) return id.slice(5);
    return id;
  };

  const getProviderForUrl = (): string => {
    const provider = product.provider.toLowerCase();
    if (provider === 'rainforest') return 'amazon';
    if (provider === 'amazon' || provider === 'ebay') return provider;
    return 'amazon';
  };

  return (
    <Link
      to={`/product/${getProviderForUrl()}/${encodeURIComponent(getProductIdForUrl())}`}
      state={{ product: { id: product.id, provider: product.provider, title: product.title, imageUrl: product.imageUrl, priceUsd: product.priceUsd, rating: product.rating, productUrl: product.productUrl } }}
      className={cn(
        "group block bg-[#1a1d23] border border-white/10 rounded-xl sm:rounded-2xl overflow-hidden transition-all duration-200 hover:border-white/20 hover:shadow-lg hover:shadow-black/30",
        className
      )}
    >
      {/* Image Container — white bg for product visibility */}
      <div className={cn(
        "relative overflow-hidden bg-white",
        compact ? "aspect-[4/3]" : "aspect-[4/3] sm:aspect-square"
      )}>
        <img
          src={product.imageUrl || '/placeholder.svg'}
          alt={product.title}
          className={cn(
            "w-full h-full object-contain transition-transform duration-200 group-hover:scale-105",
            compact ? "p-1.5" : "p-2.5 sm:p-4"
          )}
          loading="lazy"
        />
        
        {/* Provider Badge */}
        <Badge 
          variant="outline" 
          className={cn(
            "absolute top-2 left-2",
            providerColor,
            compact ? "text-[10px] px-1.5 py-0.5" : "text-xs"
          )}
        >
          {getProviderDisplayName(product.provider)}
        </Badge>

        {/* Save Button */}
        <button
          onClick={handleToggleSaved}
          className={cn(
            "absolute top-2 right-2 p-2 rounded-full transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center",
            isSaved 
              ? "bg-red-500/20 text-red-400" 
              : "bg-black/40 text-white/60 hover:text-white"
          )}
        >
          <Heart className={cn("h-4 w-4", isSaved && "fill-current")} />
        </button>

        {/* Out of Stock Overlay */}
        {product.inStock === false && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="text-white/80 font-medium text-sm">{shop.outOfStock || 'Out of Stock'}</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className={cn("space-y-1.5", compact ? "p-1.5 sm:p-2" : "p-2.5 sm:p-3")}>
        {/* Title — always 2-line clamp */}
        <h3 className={cn(
          "font-medium text-white/90 line-clamp-2",
          compact ? "text-xs min-h-[2rem]" : "text-xs sm:text-sm min-h-[2rem] sm:min-h-[2.5rem]"
        )}>
          {product.title}
        </h3>

        {/* Rating */}
        {product.rating && (
          <div className="flex items-center gap-1">
            <span className={cn("text-yellow-400", compact ? "text-xs" : "")}>★</span>
            <span className={cn("text-white/60", compact ? "text-[10px]" : "text-xs")}>{product.rating.toFixed(1)}</span>
          </div>
        )}

        {/* Price & Add to Cart */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <span className={cn("font-bold text-white", compact ? "text-sm" : "text-base sm:text-lg")}>
              ${product.priceUsd.toFixed(2)}
            </span>
            <span className={cn("text-white/50 block", compact ? "text-[10px]" : "text-xs")}>
              ≈ CDF {(product.priceUsd * exchangeRate).toLocaleString()}
            </span>
          </div>
          
          <Button
            size="sm"
            onClick={handleAddToCart}
            disabled={adding || product.inStock === false}
            className={cn(
              "rounded-full transition-all",
              compact ? "h-9 w-9 p-0" : "min-h-[40px] min-w-[40px]",
              added 
                ? "bg-green-500 hover:bg-green-600" 
                : "bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600"
            )}
          >
            {adding ? (
              <Loader2 className={cn("animate-spin", compact ? "h-3 w-3" : "h-4 w-4")} />
            ) : added ? (
              <Check className={cn(compact ? "h-3 w-3" : "h-4 w-4")} />
            ) : (
              <ShoppingCart className={cn(compact ? "h-3 w-3" : "h-4 w-4")} />
            )}
          </Button>
        </div>
      </div>
    </Link>
  );
}
