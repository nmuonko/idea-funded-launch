import { Link, useNavigate } from 'react-router-dom';
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
  const navigate = useNavigate();
  const displayItems = items.slice(0, 4);

  if (loading) {
    return (
      <div className="bg-[#1a1d23] border border-white/[0.1] rounded-2xl p-4 flex flex-col h-full shadow-md">
        <div className="h-5 w-32 bg-white/[0.08] rounded mb-3 shimmer" />
        <div className="grid grid-cols-2 gap-3 flex-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-square bg-white/[0.06] rounded-lg shimmer" />
              <div className="h-3 w-full bg-white/[0.06] rounded shimmer" />
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

  const paddedItems = [...displayItems];
  while (paddedItems.length < 4) {
    paddedItems.push(null as any);
  }

  const handleVoirPlus = () => {
    navigate(`/?tab=${categoryKey}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="bg-[#1a1d23] border border-white/[0.1] rounded-2xl p-4 flex flex-col h-full shadow-md hover:border-white/[0.18] transition-colors">
      <h3 className="text-base font-bold text-white/95 mb-3">{title}</h3>

      {/* 2x2 preview grid — always exactly 4 slots, no load-more */}
      <div className="grid grid-cols-2 gap-3 flex-1">
        {paddedItems.map((product, idx) => {
          if (!product) {
            return (
              <div key={`empty-${idx}`} className="flex flex-col">
                <div className="aspect-square rounded-lg bg-white/[0.04] border border-white/[0.06]" />
              </div>
            );
          }
          return (
            <Link
              key={product.id}
              to={getProductLink(product)}
              state={{ product }}
              className="group flex flex-col"
            >
              <div className="aspect-square rounded-lg bg-white overflow-hidden p-2 border border-white/[0.06] shadow-sm">
                <img
                  src={product.imageUrl || '/placeholder.svg'}
                  alt={product.title}
                  className="w-full h-full object-contain transition-transform duration-200 group-hover:scale-105"
                  loading="lazy"
                />
              </div>
              <p className="mt-1.5 text-xs text-white/75 line-clamp-2 leading-tight">
                {product.title}
              </p>
            </Link>
          );
        })}
      </div>

      <button
        onClick={handleVoirPlus}
        className="mt-3 text-sm text-blue-400 hover:text-blue-300 font-medium text-left transition-colors"
      >
        {language === 'fr' ? 'Voir plus' : 'See more'}
      </button>
    </div>
  );
}
