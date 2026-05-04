import { useRef, useEffect, useCallback, useState } from 'react';
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
  autoScroll?: boolean;
  autoScrollInterval?: number;
}

export function HorizontalProductRow({ 
  products, 
  loading = false, 
  skeletonCount = 6,
  className,
  autoScroll = false,
  autoScrollInterval = 3000,
}: HorizontalProductRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  const scroll = (direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const scrollAmount = 280;
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  // Auto-scroll logic
  useEffect(() => {
    if (!autoScroll || paused || loading || products.length === 0) return;
    const el = scrollRef.current;
    if (!el) return;

    const interval = setInterval(() => {
      const maxScroll = el.scrollWidth - el.clientWidth;
      if (el.scrollLeft >= maxScroll - 2) {
        el.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        el.scrollBy({ left: 200, behavior: 'smooth' });
      }
    }, autoScrollInterval);

    return () => clearInterval(interval);
  }, [autoScroll, paused, loading, products.length, autoScrollInterval]);

  const handleMouseEnter = useCallback(() => setPaused(true), []);
  const handleMouseLeave = useCallback(() => setPaused(false), []);
  const handleTouchStart = useCallback(() => setPaused(true), []);
  const handleTouchEnd = useCallback(() => {
    setTimeout(() => setPaused(false), 2000);
  }, []);

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
    <div 
      className={cn("relative group", className)}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Left fade overlay */}
      <div className="absolute left-0 top-0 w-8 h-full bg-gradient-to-r from-white to-transparent z-10 pointer-events-none" />
      {/* Right fade */}
      <div className="absolute right-0 top-0 w-8 h-full bg-gradient-to-l from-white to-transparent z-10 pointer-events-none" />

      {/* Left arrow */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => scroll('left')}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-20 bg-white/90 hover:bg-white text-black rounded-full h-10 w-10 opacity-100 transition-opacity hidden md:flex border border-black/10"
      >
        <ChevronLeft className="h-5 w-5" />
      </Button>

      {/* Right arrow */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => scroll('right')}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-20 bg-white/90 hover:bg-white text-black rounded-full h-10 w-10 opacity-100 transition-opacity hidden md:flex border border-black/10"
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
            className="w-44 sm:w-48 flex-shrink-0"
            compact
          />
        ))}
      </div>
    </div>
  );
}
