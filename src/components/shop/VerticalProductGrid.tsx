import { ProductCard, Product } from '@/components/shop/ProductCard';
import { ProductCardSkeleton } from '@/components/shop/ProductCardSkeleton';
import { cn } from '@/lib/utils';

interface VerticalProductGridProps {
  products: Product[];
  loading?: boolean;
  skeletonCount?: number;
  className?: string;
}

/**
 * Full-page vertically scrolling product grid (Amazon-like layout)
 * Responsive: 2 columns mobile, 3 tablet, 4-6 desktop
 */
export function VerticalProductGrid({ 
  products, 
  loading = false, 
  skeletonCount = 12,
  className 
}: VerticalProductGridProps) {
  if (loading) {
    return (
      <div className={cn(
        "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4",
        className
      )}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return null;
  }

  return (
    <div className={cn(
      "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 md:gap-4",
      className
    )}>
      {products.map((product) => (
        <ProductCard 
          key={`${product.provider}-${product.id}`} 
          product={product}
          compact
        />
      ))}
    </div>
  );
}
