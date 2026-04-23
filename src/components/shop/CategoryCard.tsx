import { Link } from 'react-router-dom';
import { Product } from '@/components/shop/ProductCard';
import { useLanguage } from '@/contexts/LanguageContext';
import { ArrowRight } from 'lucide-react';
import { prefetchCatalogCategory } from '@/lib/catalogCache';
import { useCallback } from 'react';
import { handleImageError, handleImageLoad, isRenderableImageUrl, pickBestImage } from '@/lib/imageValidation';
import { resizeImageUrl, IMAGE_SIZE_THUMB } from '@/lib/imageResize';

interface CategoryCardProps {
  title: string;
  items: Product[];
  categoryKey: string;
  loading?: boolean;
}

export function CategoryCard({ title, items, categoryKey, loading }: CategoryCardProps) {
  const { language } = useLanguage();

  const handlePrefetch = useCallback(() => {
    prefetchCatalogCategory(categoryKey, language);
  }, [categoryKey, language]);

  const getProductLink = (product: Product) => {
    const provider = product.provider?.toLowerCase() === 'rainforest' ? 'amazon' : product.provider?.toLowerCase();
    let pid = product.id;
    if (pid.toLowerCase().startsWith('amazon_')) pid = pid.slice(7);
    else if (pid.toLowerCase().startsWith('rainforest_')) pid = pid.slice(11);
    else if (pid.toLowerCase().startsWith('ebay_')) pid = pid.slice(5);
    return `/product/${provider || 'amazon'}/${encodeURIComponent(pid)}`;
  };

  const categoryLink = `/category/${categoryKey}`;

  // Loading state: show skeleton
  if (loading) {
    return (
      <div className="bg-[#1a1d23] border border-white/10 rounded-2xl p-3 flex flex-col h-full shadow-md shadow-black/20">
        <div className="flex items-center justify-between mb-2.5">
          <div className="h-5 w-32 bg-white/[0.08] rounded animate-pulse" />
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

  // Empty state: show title + message + see more link (never hide)
  if (items.length === 0) {
    return (
      <div
        className="bg-[#1a1d23] border border-white/10 rounded-2xl p-3 flex flex-col h-full shadow-md shadow-black/20"
        onMouseEnter={handlePrefetch}
      >
        <div className="flex items-center justify-between mb-2.5">
          <h3 className="text-sm font-bold text-white/95 truncate">{title}</h3>
        </div>
        <div className="flex-1 flex items-center justify-center min-h-[160px]">
          <p className="text-xs text-white/40 text-center">
            {language === 'fr' ? 'Aucun produit disponible' : 'No products available'}
          </p>
        </div>
        <Link
          to={categoryLink}
          onTouchStart={handlePrefetch}
          className="mt-2.5 flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 font-medium transition-colors"
        >
          {language === 'fr' ? 'Voir plus' : 'See more'}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    );
  }

  // Normal state: show up to 4 items, fill remaining with subtle placeholders
  const displayItems = items.slice(0, 4);
  const emptySlots = Math.max(0, 4 - displayItems.length);

  return (
    <div
      className="bg-[#1a1d23] border border-white/10 rounded-2xl p-3 flex flex-col h-full shadow-md shadow-black/20 hover:border-white/[0.18] transition-colors"
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 320px' } as React.CSSProperties}
      onMouseEnter={handlePrefetch}
    >
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-sm font-bold text-white/95 truncate">{title}</h3>
      </div>

      <div className="grid grid-cols-2 gap-2 flex-1">
        {displayItems.map((product, idx) => (
          (() => {
            const selectedImage = pickBestImage([product.imageUrl, ...(product.images || []), ...(product.imageUrls || [])], product.imageUrl, { policy: 'homepage' });
            const fallbackImages = [...new Set([product.imageUrl, ...(product.images || []), ...(product.imageUrls || [])].filter(Boolean as any))]
              .map((url) => resizeImageUrl(url as string, IMAGE_SIZE_THUMB))
              .filter((url) => url !== resizeImageUrl(selectedImage, IMAGE_SIZE_THUMB));
            const resolvedSrc = selectedImage === '/placeholder.svg' ? '' : resizeImageUrl(selectedImage, IMAGE_SIZE_THUMB);
            return (
          <Link
            key={`${product.id}-${idx}`}
            to={getProductLink(product)}
            state={{ product }}
            className="group flex flex-col"
          >
            <div className="aspect-square rounded-lg bg-white overflow-hidden p-1.5 border border-gray-100 shadow-sm">
              {resolvedSrc && isRenderableImageUrl(resolvedSrc, 'homepage') ? (
                <img
                  src={resolvedSrc}
                  alt={product.title}
                  className="w-full h-full object-contain transition-transform duration-200 group-hover:scale-105"
                  loading="lazy"
                  data-image-policy="homepage"
                  data-fallback-images={fallbackImages.join('|||')}
                  onLoad={handleImageLoad}
                  onError={handleImageError}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground text-[10px]">
                  No image
                </div>
              )}
            </div>
            <p className="mt-1 text-[11px] text-white/70 line-clamp-2 leading-tight">
              {product.title}
            </p>
          </Link>
            );
          })()
        ))}
        {/* Subtle empty placeholders for missing slots */}
        {emptySlots > 0 && Array.from({ length: emptySlots }).map((_, i) => (
          <div key={`empty-${i}`} className="flex flex-col">
            <div className="aspect-square rounded-lg bg-white/[0.03] border border-white/[0.05]" />
          </div>
        ))}
      </div>

      <Link
        to={categoryLink}
        onTouchStart={handlePrefetch}
        className="mt-2.5 flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 font-medium transition-colors"
      >
        {language === 'fr' ? 'Voir plus' : 'See more'}
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
