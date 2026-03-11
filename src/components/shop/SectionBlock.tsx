import { Product, ProductCard } from '@/components/shop/ProductCard';
import { HorizontalProductRow } from '@/components/shop/HorizontalProductRow';
import { CategoryCard } from '@/components/shop/CategoryCard';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { isRenderableImageUrl } from '@/lib/imageValidation';

interface SectionBlockProps {
  title?: string;
  hideTitle?: boolean;
  items: Product[];
  loading?: boolean;
  mode?: 'scroll' | 'grid' | 'static-grid';
  categoryKey?: string;
  seeAllLink?: string;
  maxItems?: number;
}

export function SectionBlock({ title, hideTitle, items, loading, mode = 'scroll', categoryKey, seeAllLink, maxItems = 16 }: SectionBlockProps) {
  const { language } = useLanguage();

  // For grid mode, always render (show loading skeleton if empty)
  // For other modes, hide if no items and not loading
  if (!loading && items.length === 0 && mode !== 'grid') return null;

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
    const visibleItems = items.slice(0, Math.max(1, maxItems));

    const getProductLink = (product: Product) => {
      const provider = product.provider?.toLowerCase() === 'rainforest' ? 'amazon' : product.provider?.toLowerCase();
      let pid = product.id;
      if (pid.toLowerCase().startsWith('amazon_')) pid = pid.slice(7);
      else if (pid.toLowerCase().startsWith('rainforest_')) pid = pid.slice(11);
      else if (pid.toLowerCase().startsWith('ebay_')) pid = pid.slice(5);
      return `/product/${provider || 'amazon'}/${encodeURIComponent(pid)}`;
    };

    return (
      <div className="bg-[#1a1d23] border border-white/[0.1] rounded-2xl p-3 sm:p-4 shadow-md shadow-black/20">
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8 xl:grid-cols-8 gap-2">
          {visibleItems.map((product, idx) => (
            <Link
              key={`${product.id}-${idx}`}
              to={getProductLink(product)}
              state={{ product }}
              className="group flex flex-col"
            >
              <div className="aspect-square rounded-lg bg-white overflow-hidden p-1.5 border border-gray-100 shadow-sm">
                <img
                  src={product.imageUrl || '/placeholder.svg'}
                  alt={product.title}
                  className="w-full h-full object-contain transition-transform duration-200 group-hover:scale-105 image-rendering-auto"
                  loading="lazy"
                  decoding="async"
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = '/placeholder.svg';
                  }}
                />
              </div>
              <p className="mt-1 text-[11px] text-white/70 line-clamp-2 leading-tight">
                {product.title}
              </p>
            </Link>
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
