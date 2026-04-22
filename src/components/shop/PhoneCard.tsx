import { useEffect, useState, useCallback } from 'react';
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

  useEffect(() => {
    setImgSrc(pickBestImage(galleryImages, product.imageUrl));
    setFallbackIdx(0);
  }, [product.id, product.imageUrl, galleryImages]);

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
      // Reject banner-like, strip-like, or tiny images.
      // Phone product photos are tall (ratio ~0.5-0.9). Banners are wide (>1.4).
      if (ratio > 1.5 || ratio < 0.4 || Math.min(w, h) < 80) tryNextImage();
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
        'group block bg-white rounded-md overflow-hidden ring-1 ring-black/[0.04] transition-all duration-200 hover:shadow-[0_4px_14px_-6px_rgba(0,0,0,0.12)] hover:-translate-y-0.5',
        className,
      )}
    >
      {/* Image panel — soft warm neutral, calm & premium */}
      <div
        className="relative w-full aspect-square flex items-center justify-center bg-[#F0EBE3]"
      >
        {showImage ? (
          <img
            src={imgSrc}
            alt={product.title}
            loading="lazy"
            onLoad={handleImgLoad}
            onError={tryNextImage}
            className="max-w-[68%] max-h-[78%] object-contain transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="text-neutral-400 text-xs">No image</div>
        )}
      </div>

      {/* Text area — clean, catalog-style */}
      <div className="px-3.5 pt-3 pb-3.5 bg-white">
        <h3 className="text-[13px] sm:text-sm font-medium text-neutral-800 leading-snug line-clamp-2 min-h-[2.4rem]">
          {product.title}
        </h3>
        <div className="mt-2">
          <span className="text-base sm:text-lg font-bold text-neutral-900 tracking-tight">
            {priceLabel}
          </span>
        </div>
      </div>
    </Link>
  );
}
