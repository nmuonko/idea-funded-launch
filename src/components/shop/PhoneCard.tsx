import { useEffect, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resizeImageUrl, IMAGE_SIZE_THUMB } from '@/lib/imageResize';
import { collectProductImageCandidates, handleImageError, handleImageLoad, pickBestImage } from '@/lib/imageValidation';
import { formatDisplayPriceUsd } from '@/lib/displayPrice';
import { formatPhoneDisplayName } from '@/lib/phoneDisplayName';
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
  const galleryImages = useMemo(
    () => collectProductImageCandidates(product.imageUrl, product.images, product.imageUrls),
    [product.imageUrl, product.images, product.imageUrls]
  );
  const imagePolicy = 'homepage';
  const fallbackImages = useMemo(() => {
    const selected = pickBestImage(galleryImages, product.imageUrl, { policy: imagePolicy });
    const normalizedSelected = resizeImageUrl(selected, IMAGE_SIZE_THUMB);
    return galleryImages
      .map((url) => resizeImageUrl(url, IMAGE_SIZE_THUMB))
      .filter((url, index, arr) => url !== normalizedSelected && arr.indexOf(url) === index);
  }, [galleryImages, product.imageUrl]);

  const [imgSrc, setImgSrc] = useState<string>(() =>
    resizeImageUrl(pickBestImage(galleryImages, product.imageUrl, { policy: imagePolicy }), IMAGE_SIZE_THUMB)
  );

  useEffect(() => {
    setImgSrc(resizeImageUrl(pickBestImage(galleryImages, product.imageUrl, { policy: imagePolicy }), IMAGE_SIZE_THUMB));
  }, [product.id, product.imageUrl, galleryImages]);

  const handleImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    handleImageLoad(e);
    if (e.currentTarget.src.endsWith('/placeholder.svg')) setImgSrc('/placeholder.svg');
    else setImgSrc(e.currentTarget.currentSrc || e.currentTarget.src);
  }, []);

  const handleImgError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    handleImageError(e);
    if (e.currentTarget.src.endsWith('/placeholder.svg')) setImgSrc('/placeholder.svg');
    else setImgSrc(e.currentTarget.currentSrc || e.currentTarget.src);
  }, []);

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
  const { name: displayName, storage } = useMemo(
    () => formatPhoneDisplayName(product.title),
    [product.title]
  );

  // If no valid product image is available (only banners/promos), hide the card
  // entirely instead of showing an "ad-looking" tile on the homepage.
  if (!showImage) return null;

  return (
    <Link
      to={`/product/${getProviderForUrl()}/${encodeURIComponent(getProductIdForUrl())}`}
      state={{ product: { id: product.id, provider: product.provider, title: product.title, imageUrl: product.imageUrl, priceUsd: product.priceUsd, rating: product.rating, productUrl: product.productUrl } }}
      className={cn(
        'group block rounded-xl bg-white border border-[#EAE2D6] overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md',
        className,
      )}
    >
      {/* Image panel */}
      <div className="relative w-full aspect-square flex items-center justify-center bg-white">
        {showImage ? (
          <img
            src={imgSrc}
            alt={displayName}
            loading="lazy"
            data-image-policy={imagePolicy}
            data-fallback-images={fallbackImages.join('|||')}
            onLoad={handleImgLoad}
            onError={handleImgError}
            className="max-w-[78%] max-h-[82%] object-contain transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="text-neutral-400 text-xs">No image</div>
        )}
        <span
          className="absolute top-2 right-2 inline-flex items-center justify-center w-7 h-7 rounded-full bg-white border border-[#EAE2D6] text-neutral-400"
          aria-hidden
        >
          <Heart className="w-3.5 h-3.5" />
        </span>
      </div>

      {/* Text area — clean, catalog-style */}
      <div className="px-3 pt-2 pb-3">
        <h3 className="text-[13px] font-semibold text-neutral-900 leading-snug line-clamp-1">
          {displayName}
        </h3>
        {storage && (
          <p className="text-[11px] text-neutral-500 mt-0.5">{storage}</p>
        )}
        <div className="mt-1.5">
          <span className="text-[15px] font-bold text-neutral-900 tracking-tight">
            {priceLabel}
          </span>
        </div>
      </div>
    </Link>
  );
}
