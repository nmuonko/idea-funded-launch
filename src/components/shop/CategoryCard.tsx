import { Link } from 'react-router-dom';
import { Product } from '@/components/shop/ProductCard';
import { useLanguage } from '@/contexts/LanguageContext';

interface CategoryCardProps {
  title: string;
  items: Product[];
  categoryKey: string;
  loading?: boolean;
}

export function CategoryCard({ title, items, categoryKey, loading }: CategoryCardProps) {
  const { language } = useLanguage();
  const displayItems = items.slice(0, 4);

  if (loading) {
    return (
      <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4 flex flex-col h-full">
        <div className="h-5 w-32 bg-white/10 rounded mb-3 shimmer" />
        <div className="grid grid-cols-2 gap-3 flex-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-square bg-white/10 rounded-lg shimmer" />
              <div className="h-3 w-full bg-white/10 rounded shimmer" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (displayItems.length === 0) return null;

  const getProductLink = (product: Product) => {
    const provider = product.provider?.toLowerCase() === 'rainforest' ? 'amazon' : product.provider?.toLowerCase();
    let pid = product.id;
    if (pid.toLowerCase().startsWith('amazon_')) pid = pid.slice(7);
    else if (pid.toLowerCase().startsWith('rainforest_')) pid = pid.slice(11);
    else if (pid.toLowerCase().startsWith('ebay_')) pid = pid.slice(5);
    return `/product/${provider || 'amazon'}/${encodeURIComponent(pid)}`;
  };

  return (
    <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-4 flex flex-col h-full">
      {/* Title */}
      <h3 className="text-base font-bold text-white mb-3">{title}</h3>

      {/* 2x2 Grid */}
      <div className="grid grid-cols-2 gap-3 flex-1">
        {displayItems.map((product) => (
          <Link
            key={product.id}
            to={getProductLink(product)}
            state={{ product }}
            className="group flex flex-col"
          >
            {/* Image */}
            <div className="aspect-square rounded-lg bg-neutral-100 overflow-hidden p-2">
              <img
                src={product.imageUrl || '/placeholder.svg'}
                alt={product.title}
                className="w-full h-full object-contain transition-transform duration-200 group-hover:scale-105"
                loading="lazy"
              />
            </div>
            {/* Label */}
            <p className="mt-1.5 text-xs text-white/80 line-clamp-1 leading-tight">
              {product.title}
            </p>
          </Link>
        ))}
      </div>

      {/* See more */}
      <button
        onClick={() => {
          const el = document.getElementById(`section-${categoryKey}`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
        className="mt-3 text-sm text-cyan-400 hover:text-cyan-300 font-medium text-left transition-colors"
      >
        {language === 'fr' ? 'Voir plus' : 'See more'}
      </button>
    </div>
  );
}
