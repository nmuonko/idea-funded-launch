import { Link, useNavigate } from 'react-router-dom';
import { Product } from '@/components/shop/ProductCard';
import { useLanguage } from '@/contexts/LanguageContext';
import { ArrowRight } from 'lucide-react';

interface CategoryCardProps {
  title: string;
  items: Product[];
  categoryKey: string;
  loading?: boolean;
}

export function CategoryCard({ title, items, categoryKey, loading }: CategoryCardProps) {
  const { language } = useLanguage();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="bg-[#1a1d23] border border-white/10 rounded-2xl p-3 flex flex-col h-full shadow-md shadow-black/20">
        <div className="h-5 w-32 bg-white/[0.08] rounded mb-3 animate-pulse" />
        <div className="grid grid-cols-2 gap-2 flex-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="aspect-square bg-white/[0.06] rounded-lg animate-pulse" />
              <div className="h-3 w-full bg-white/[0.06] rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (items.length === 0 && !loading) {
    // Show skeleton with title while search fallback is loading
    return (
      <div className="bg-[#1a1d23] border border-white/10 rounded-2xl p-3 flex flex-col h-full shadow-md shadow-black/20">
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-sm font-bold text-white/95 truncate">{title}</h3>
        </div>
        <div className="grid grid-cols-2 gap-2 flex-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="aspect-square bg-white/[0.06] rounded-lg animate-pulse" />
              <div className="h-3 w-full bg-white/[0.06] rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Show only actual items (up to 4), never placeholders or repeated items
  const displayItems = items.slice(0, 4);

  const getProductLink = (product: Product) => {
    const provider = product.provider?.toLowerCase() === 'rainforest' ? 'amazon' : product.provider?.toLowerCase();
    let pid = product.id;
    if (pid.toLowerCase().startsWith('amazon_')) pid = pid.slice(7);
    else if (pid.toLowerCase().startsWith('rainforest_')) pid = pid.slice(11);
    else if (pid.toLowerCase().startsWith('ebay_')) pid = pid.slice(5);
    return `/product/${provider || 'amazon'}/${encodeURIComponent(pid)}`;
  };

  const handleVoirPlus = () => {
    navigate(`/category/${categoryKey}`);
  };

  return (
    <div className="bg-[#1a1d23] border border-white/10 rounded-2xl p-3 flex flex-col h-full shadow-md shadow-black/20 hover:border-white/[0.18] transition-colors">
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-sm font-bold text-white/95 truncate">{title}</h3>
      </div>

      <div className="grid grid-cols-2 gap-2 flex-1">
        {displayItems.map((product, idx) => (
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
                className="w-full h-full object-contain transition-transform duration-200 group-hover:scale-105"
                loading="lazy"
              />
            </div>
            <p className="mt-1 text-[11px] text-white/70 line-clamp-2 leading-tight">
              {product.title}
            </p>
          </Link>
        ))}
      </div>

      <button
        onClick={handleVoirPlus}
        className="mt-2.5 flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 font-medium transition-colors"
      >
        {language === 'fr' ? 'Voir plus' : 'See more'}
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
