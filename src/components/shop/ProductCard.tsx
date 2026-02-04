import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingCart, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useShopCart } from '@/contexts/ShopCartContext';
import { cn } from '@/lib/utils';

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
}

export function ProductCard({ product, className }: ProductCardProps) {
  const { addItem } = useShopCart();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

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

  const providerColor = product.provider === 'amazon' 
    ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    : 'bg-blue-500/20 text-blue-400 border-blue-500/30';

  return (
    <Link
      to={`/shop/product/${product.provider}/${encodeURIComponent(product.id)}`}
      className={cn(
        "group block bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl overflow-hidden transition-all duration-300 hover:bg-white/10 hover:border-white/20 hover:scale-[1.02]",
        className
      )}
    >
      {/* Image Container */}
      <div className="relative aspect-square overflow-hidden bg-white/5">
        <img
          src={product.imageUrl || '/placeholder.svg'}
          alt={product.title}
          className="w-full h-full object-contain p-4 transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />
        
        {/* Provider Badge */}
        <Badge 
          variant="outline" 
          className={cn("absolute top-2 left-2 text-xs capitalize", providerColor)}
        >
          {product.provider}
        </Badge>

        {/* Out of Stock Overlay */}
        {product.inStock === false && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <span className="text-white/80 font-medium">Out of Stock</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Title */}
        <h3 className="text-sm font-medium text-white/90 line-clamp-2 min-h-[2.5rem]">
          {product.title}
        </h3>

        {/* Rating */}
        {product.rating && (
          <div className="flex items-center gap-1">
            <span className="text-yellow-400">★</span>
            <span className="text-xs text-white/60">{product.rating.toFixed(1)}</span>
          </div>
        )}

        {/* Price & Add to Cart */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-lg font-bold text-white">
            ${product.priceUsd.toFixed(2)}
          </span>
          
          <Button
            size="sm"
            onClick={handleAddToCart}
            disabled={adding || product.inStock === false}
            className={cn(
              "rounded-full transition-all",
              added 
                ? "bg-green-500 hover:bg-green-600" 
                : "bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600"
            )}
          >
            {adding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : added ? (
              <Check className="h-4 w-4" />
            ) : (
              <ShoppingCart className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </Link>
  );
}
