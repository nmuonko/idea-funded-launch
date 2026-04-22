import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useShopCart } from '@/contexts/ShopCartContext';
import { resizeImageUrl, IMAGE_SIZE_THUMB } from '@/lib/imageResize';
import { isRenderableImageUrl, pickBestImage } from '@/lib/imageValidation';
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
  const { exchangeRate } = useShopCart();

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
  const price = product.priceUsd;

  return (
    <Link
      to={`/product/${getProviderForUrl()}/${encodeURIComponent(getProductIdForUrl())}`}
      state={{ product: { id: product.id, provider: product.provider, title: product.title, imageUrl: product.imageUrl, priceUsd: product.priceUsd, rating: product.rating, productUrl: product.productUrl } }}
      className={cn(
        'group block bg-transparent transition-opacity duration-200 hover:opacity-95',
        className,
      )}
    >
      {/* Image panel — Gazelle style: landscape ~4:3, image fills full card width */}
      <div
        className="relative w-full aspect-[4/3] flex items-center justify-center overflow-hidden"
        style={{ backgroundColor: '#efe9e1' }}
      >
        {showImage ? (
          <img
            src={imgSrc}
            alt={product.title}
            loading="lazy"
            onLoad={handleImgLoad}
            onError={tryNextImage}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="text-neutral-400 text-xs">No image</div>
        )}
      </div>

      {/* Text area — Gazelle style: title fully visible, USD only */}
      <div className="pt-2 pb-1">
        <h3 className="text-[14px] font-semibold text-neutral-900 leading-tight line-clamp-3">
          {product.title}
        </h3>
        <div className="mt-1.5">
          <span className="text-[15px] font-bold text-orange-600">
            ${price.toFixed(0)}
          </span>
        </div>
      </div>
    </Link>
  );
}
