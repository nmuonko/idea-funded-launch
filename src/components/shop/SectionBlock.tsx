import { Product, ProductCard } from '@/components/shop/ProductCard';
import { HorizontalProductRow } from '@/components/shop/HorizontalProductRow';
import { CategoryCard } from '@/components/shop/CategoryCard';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';

interface SectionBlockProps {
  title?: string;
  hideTitle?: boolean;
  items: Product[];
  loading?: boolean;
  mode?: 'scroll' | 'grid' | 'static-grid';
  categoryKey?: string;
  seeAllLink?: string;
}

export function SectionBlock({ title, hideTitle, items, loading, mode = 'scroll', categoryKey, seeAllLink }: SectionBlockProps) {
  const { language } = useLanguage();

  if (!loading && items.length === 0) return null;

  if (mode === 'grid') {
    return (
      <CategoryCard
        title={title || ''}
        items={items}
        categoryKey={categoryKey || ''}
        loading={loading}
      />
    );
  }

  if (mode === 'static-grid') {
    return (
      <div className="bg-[#1a1d23] border border-white/[0.1] rounded-2xl p-3 sm:p-4 shadow-md">
        {title && !hideTitle && (
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-lg font-semibold text-white/95">{title}</h2>
            {seeAllLink && (
              <Link to={seeAllLink} className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 font-medium transition-colors">
                {language === 'fr' ? 'Voir plus' : 'See more'}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        )}
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
          {items.slice(0, 12).map((product) => (
            <ProductCard key={product.id} product={product} compact />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#1a1d23] border border-white/[0.1] rounded-2xl p-3 sm:p-4 shadow-md">
      {title && !hideTitle && (
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-lg font-semibold text-white/95">{title}</h2>
          {seeAllLink && (
            <Link to={seeAllLink} className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 font-medium transition-colors">
              {language === 'fr' ? 'Voir plus' : 'See more'}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}
      {loading && !hideTitle && !title && (
        <div className="h-5 w-40 bg-white/[0.08] rounded mb-3 shimmer" />
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
