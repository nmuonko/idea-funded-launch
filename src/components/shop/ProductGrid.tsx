import { memo } from 'react';
import { ProductCard, Product } from './ProductCard';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const MemoizedProductCard = memo(ProductCard);

interface ProductGridProps {
  products: Product[];
  loading?: boolean;
  skeletonCount?: number;
  className?: string;
}

export function ProductGrid({ products, loading, skeletonCount = 8, className }: ProductGridProps) {
  if (loading) {
    return (
      <div className={cn(
        "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2",
        className
      )}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <ProductCardSkeleton key={i} compact />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-white/60">No products found</p>
      </div>
    );
  }

  return (
    <div className={cn(
      "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2",
      className
    )}>
      {products.map((product) => (
        <div
          key={`${product.provider}-${product.id}`}
          style={{ contentVisibility: 'auto', containIntrinsicSize: '0 280px' }}
        >
          <MemoizedProductCard product={product} compact />
        </div>
      ))}
    </div>
  );
}

function ProductCardSkeleton({ compact = true }: { compact?: boolean }) {
  return (
    <div className="bg-white/5 border border-white/[0.15] rounded-xl overflow-hidden">
      <Skeleton className={cn("bg-white/20", compact ? "aspect-square" : "aspect-[4/3] sm:aspect-square")} />
      <div className={cn("space-y-1.5", compact ? "p-1.5 sm:p-2" : "p-2.5 sm:p-4 space-y-2 sm:space-y-3")}>
        <Skeleton className="h-3 w-full bg-white/10" />
        <Skeleton className="h-3 w-2/3 bg-white/10" />
        <div className="flex items-center justify-between">
          <Skeleton className={cn("bg-white/10", compact ? "h-4 w-14" : "h-6 w-20")} />
          <Skeleton className={cn("rounded-full bg-white/10", compact ? "h-7 w-7" : "h-8 w-8")} />
        </div>
      </div>
    </div>
  );
}

export { ProductCardSkeleton };
