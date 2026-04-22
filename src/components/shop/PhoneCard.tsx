import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { resizeImageUrl, IMAGE_SIZE_THUMB } from '@/lib/imageResize';
import { isRenderableImageUrl, pickBestImage } from '@/lib/imageValidation';
import { formatDisplayPriceUsd } from '@/lib/displayPrice';
import type { Product } from './ProductCard';

interface PhoneCardProps {
  product: Product;
  className?: string;
}

/**
 * Gazelle-style clean catalog card.
 * - Light neutral image panel
 * - Large centered phone image
 * - Compact title + bold price below
 * - Minimal chrome — the device is the hero
 */
export function PhoneCard({ product, className }: PhoneCardProps) {
  const galleryImages = [...new Set([
    product.imageUrl,
    ...(product.images || []),
    ...(product.imageUrls || []),
  ].filter(Boolean))];

  const [imgSrc, setImgSrc] = useState<string>(() =>
    pickBestImage(galleryImages, product.imageUrl)
  );
  const [fallbackIdx, setFallbackIdx] = useState(0);

  const tryNextImage = useCallback(() => {
    for (let i = fallbackIdx + 1; i < galleryImages.length; i++) {
      const url = galleryImages[i];
      if (url && isRenderableImageUrl(url) && resizeImageUrl(url, IMAGE_SIZE_THUMB) !== imgSrc) {
        setFallbackIdx(i);
        setImgSrc(resizeImageUrl(url, IMAGE_SIZE_THUMB));
        return;
      }
    }
    setImgSrc('/placeholder.svg');
  }, [fallbackIdx, galleryImages, imgSrc]);

  const handleImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const { naturalWidth: w, naturalHeight: h } = img;
    if (w > 0 && h > 0) {
      const ratio = w / h;
      // Reject banner-like or tiny images
      if (ratio > 2.2 || ratio < 0.45 || Math.min(w, h) < 70) tryNextImage();
    }
  }, [tryNextImage]);

  const getProviderForUrl = (): string => {
    const provider = product.provider.toLowerCase();
    if (provider === 'rainforest') return 'amazon';
    return provider;
  };
  const getProductIdForUrl = (): string => {
    const id = product.id;
    if (id.toLowerCase().startsWith('amazon_')) return id.slice(7);
    if (id.toLowerCase().startsWith('rainforest_')) return id.slice(11);
    if (id.toLowerCase().startsWith('ebay_')) return id.slice(5);
    return id;
  };

  const showImage = imgSrc !== '/placeholder.svg';
  const priceLabel = formatDisplayPriceUsd(product.priceUsd);

  return (
    <Link
      to={`/product/${getProviderForUrl()}/${encodeURIComponent(getProductIdForUrl())}`}
      state={{ product: { id: product.id, provider: product.provider, title: product.title, imageUrl: product.imageUrl, priceUsd: product.priceUsd, rating: product.rating, productUrl: product.productUrl } }}
      className={cn(
        'group block bg-white rounded-lg overflow-hidden border border-black/5 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5',
        className,
      )}
    >
      {/* Image panel — softer warm neutral, easier on the eyes */}
      <div
        className="relative w-full aspect-square flex items-center justify-center bg-[#1f304c]"
      >
        {showImage ? (
          <img
            src={imgSrc}
            alt={product.title}
            loading="lazy"
            onLoad={handleImgLoad}
            onError={tryNextImage}
            className="max-w-[82%] max-h-[82%] object-contain transition-transform duration-300 group-hover:scale-[1.03] drop-shadow-[0_2px_4px_rgba(0,0,0,0.06)]"
          />
        ) : (
          <div className="text-neutral-400 text-xs">No image</div>
        )}
      </div>

      {/* Text area — clean, retail-catalog style */}
      <div className="px-2.5 py-2 bg-white">
        <h3 className="text-[12px] sm:text-[13px] font-medium text-neutral-800 leading-snug line-clamp-2 min-h-[2.2rem]">
          {product.title}
        </h3>
        <div className="mt-1">
          <span className="text-sm sm:text-base font-bold text-neutral-900">
            {priceLabel}
          </span>
        </div>
      </div>
    </Link>
  );
}
