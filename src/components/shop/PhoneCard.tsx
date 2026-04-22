import { useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useShopCart } from '@/contexts/ShopCartContext';
import { resizeImageUrl, IMAGE_SIZE_THUMB } from '@/lib/imageResize';
import { isRenderableImageUrl, pickCleanestImage } from '@/lib/imageValidation';
import type { Product } from './ProductCard';

interface PhoneCardProps {
  product: Product;
  className?: string;
}

/**
 * Compact, premium catalog card.
 * - Soft warm neutral image panel (~#F3EEE7)
 * - Smart "cleanest image" selection: prefers Amazon _AC_ studio shots and
 *   eBay s-l1600 over busy lifestyle photos
 * - Compact text area with 2-line title clamp and tight price line
 */
export function PhoneCard({ product, className }: PhoneCardProps) {
  const { exchangeRate } = useShopCart();

  const galleryImages = useMemo(() => (
    [...new Set([
      product.imageUrl,
      ...(product.images || []),
      ...(product.imageUrls || []),
    ].filter(Boolean) as string[])]
  ), [product.imageUrl, product.images, product.imageUrls]);

  const [imgSrc, setImgSrc] = useState<string>(() =>
    pickCleanestImage(galleryImages, product.imageUrl)
  );
  const [triedUrls] = useState<Set<string>>(() => new Set([imgSrc]));

  const tryNextImage = useCallback(() => {
    for (const url of galleryImages) {
      if (!url || !isRenderableImageUrl(url)) continue;
      const sized = resizeImageUrl(url, IMAGE_SIZE_THUMB);
      if (!triedUrls.has(sized) && sized !== imgSrc) {
        triedUrls.add(sized);
        setImgSrc(sized);
        return;
      }
    }
    setImgSrc('/placeholder.svg');
  }, [galleryImages, imgSrc, triedUrls]);

  const handleImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const { naturalWidth: w, naturalHeight: h } = img;
    if (w > 0 && h > 0) {
      const ratio = w / h;
      // Reject banner-like, square crops or tiny images
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
  const price = product.priceUsd;

  return (
    <Link
      to={`/product/${getProviderForUrl()}/${encodeURIComponent(getProductIdForUrl())}`}
      state={{ product: { id: product.id, provider: product.provider, title: product.title, imageUrl: product.imageUrl, priceUsd: product.priceUsd, rating: product.rating, productUrl: product.productUrl } }}
      className={cn(
        'group block bg-white rounded-md overflow-hidden border border-black/[0.06] transition-all duration-200 hover:border-black/15 hover:shadow-sm',
        className,
      )}
    >
      {/* Image panel — soft warm neutral, studio backdrop */}
      <div
        className="relative w-full aspect-square flex items-center justify-center"
        style={{ backgroundColor: '#F3EEE7' }}
      >
        {showImage ? (
          <img
            src={imgSrc}
            alt={product.title}
            loading="lazy"
            onLoad={handleImgLoad}
            onError={tryNextImage}
            className="max-w-[72%] max-h-[72%] object-contain transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="text-neutral-400 text-[11px]">No image</div>
        )}
      </div>

      {/* Text area — compact retail catalog style */}
      <div className="px-2 py-1.5 bg-white">
        <h3 className="text-[11px] sm:text-[12px] font-medium text-neutral-800 leading-snug line-clamp-2 min-h-[2rem]">
          {product.title}
        </h3>
        <div className="mt-0.5 flex items-baseline gap-1">
          <span className="text-[13px] sm:text-sm font-semibold text-neutral-900">
            ${price.toFixed(0)}
          </span>
          <span className="text-[9px] text-neutral-400">
            ≈ CDF {(price * exchangeRate).toLocaleString()}
          </span>
        </div>
      </div>
    </Link>
  );
}
