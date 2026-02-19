import { Product, ProductCard } from '@/components/shop/ProductCard';
import { ProductCardSkeleton } from '@/components/shop/ProductCardSkeleton';

interface SectionBlockProps {
  title?: string;
  hideTitle?: boolean;
  items: Product[];
  maxItems?: number;
  loading?: boolean;
}

export function SectionBlock({ title, hideTitle, items, maxItems = 8, loading }: SectionBlockProps) {
  const displayItems = items.slice(0, maxItems);

  if (loading) {
    return (
      <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-3 sm:p-4">
        {!hideTitle && (
          <div className="h-5 w-40 bg-white/10 rounded mb-3 shimmer" />
        )}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <ProductCardSkeleton key={i} compact />
          ))}
        </div>
      </div>
    );
  }

  if (displayItems.length === 0) return null;

  return (
    <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-3 sm:p-4">
      {title && !hideTitle && (
        <h2 className="text-lg font-semibold text-white mb-3 px-1">{title}</h2>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 sm:gap-3">
        {displayItems.map((product) => (
          <ProductCard key={`${product.provider}-${product.id}`} product={product} compact />
        ))}
      </div>
    </div>
  );
}
