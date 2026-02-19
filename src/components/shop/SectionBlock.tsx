import { Product } from '@/components/shop/ProductCard';
import { HorizontalProductRow } from '@/components/shop/HorizontalProductRow';

interface SectionBlockProps {
  title?: string;
  hideTitle?: boolean;
  items: Product[];
  loading?: boolean;
}

export function SectionBlock({ title, hideTitle, items, loading }: SectionBlockProps) {
  if (!loading && items.length === 0) return null;

  return (
    <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-3 sm:p-4">
      {title && !hideTitle && (
        <h2 className="text-lg font-semibold text-white mb-3 px-1">{title}</h2>
      )}
      {loading && !hideTitle && !title && (
        <div className="h-5 w-40 bg-white/10 rounded mb-3 shimmer" />
      )}
      <HorizontalProductRow 
        products={items} 
        loading={loading} 
        autoScroll 
        autoScrollInterval={3000} 
      />
    </div>
  );
}
