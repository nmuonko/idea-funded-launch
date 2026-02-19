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
        "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-4",
        className
      )}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <ProductCardSkeleton key={i} />
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
      "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 sm:gap-4",
      className
    )}>
      {products.map((product) => (
        <div
          key={`${product.provider}-${product.id}`}
          style={{ contentVisibility: 'auto', containIntrinsicSize: '0 320px' }}
        >
          <MemoizedProductCard product={product} />
        </div>
      ))}
    </div>
  );
}

function ProductCardSkeleton() {
  return (
    <div className="bg-white/5 border border-white/[0.15] rounded-xl sm:rounded-2xl overflow-hidden">
      <Skeleton className="aspect-[4/3] sm:aspect-square bg-white/20" />
      <div className="p-2.5 sm:p-4 space-y-2 sm:space-y-3">
        <Skeleton className="h-4 w-full bg-white/10" />
        <Skeleton className="h-4 w-2/3 bg-white/10" />
        <div className="flex items-center justify-between">
          <Skeleton className="h-6 w-20 bg-white/10" />
          <Skeleton className="h-8 w-8 rounded-full bg-white/10" />
        </div>
      </div>
    </div>
  );
}

export { ProductCardSkeleton };
