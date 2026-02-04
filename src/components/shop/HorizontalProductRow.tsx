import { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ProductCard, Product } from '@/components/shop/ProductCard';
import { ProductCardSkeleton } from '@/components/shop/ProductCardSkeleton';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface HorizontalProductRowProps {
  products: Product[];
  loading?: boolean;
  skeletonCount?: number;
  className?: string;
}

export function HorizontalProductRow({ 
  products, 
  loading = false, 
  skeletonCount = 6,
  className 
}: HorizontalProductRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const scrollAmount = 280; // Roughly 1.5 cards
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  if (loading) {
    return (
      <div className={cn("relative", className)}>
        <div className="flex gap-3 overflow-x-auto scrollbar-hide px-1 py-2 -mx-1">
          {Array.from({ length: skeletonCount }).map((_, i) => (
            <div key={i} className="w-40 flex-shrink-0">
              <ProductCardSkeleton />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (products.length === 0) {
    return null;
  }

  return (
    <div className={cn("relative group", className)}>
      {/* Left fade overlay */}
      <div className="absolute left-0 top-0 w-8 h-full bg-gradient-to-r from-black to-transparent z-10 pointer-events-none" />
      
      {/* Right fade overlay */}
      <div className="absolute right-0 top-0 w-8 h-full bg-gradient-to-l from-black to-transparent z-10 pointer-events-none" />

      {/* Navigation arrows - desktop only */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => scroll('left')}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-20 bg-black/80 hover:bg-black text-white rounded-full h-10 w-10 opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex"
      >
        <ChevronLeft className="h-5 w-5" />
      </Button>
      
      <Button
        variant="ghost"
        size="icon"
        onClick={() => scroll('right')}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-20 bg-black/80 hover:bg-black text-white rounded-full h-10 w-10 opacity-0 group-hover:opacity-100 transition-opacity hidden md:flex"
      >
        <ChevronRight className="h-5 w-5" />
      </Button>

      {/* Scrollable container */}
      <div 
        ref={scrollRef}
        className="flex gap-3 overflow-x-auto scrollbar-hide px-1 py-2 -mx-1 scroll-smooth"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {products.map((product) => (
          <ProductCard 
            key={`${product.provider}-${product.id}`} 
            product={product} 
            className="w-40 flex-shrink-0"
            compact
          />
        ))}
      </div>
    </div>
  );
}
