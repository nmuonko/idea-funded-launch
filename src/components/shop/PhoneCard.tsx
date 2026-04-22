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
  /** Optional index for subtle background palette rotation across the grid */
  index?: number;
}

// Curated palette — very soft, neutral, studio-catalog feel.
// Rotates subtly across cards so the grid stays calm but not monotone.
const STUDIO_BACKGROUNDS = [
  '#F7F4EF', // warm off-white
  '#F5F1EB', // soft ivory
  '#EFE7DC', // light beige
  '#EEEAE4', // very light greige
  '#F3EEE7', // muted cream
  '#E7E2DB', // soft warm gray
];

/**
 * Gazelle-style clean catalog card.
 * - Light neutral image panel
 * - Large centered phone image
 * - Compact title + bold price below
 * - Minimal chrome — the device is the hero
 */
export function PhoneCard({ product, className, index = 0 }: PhoneCardProps) {
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
        'group block bg-white rounded-lg overflow-hidden border border-black/5 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5',
        className,
      )}
    >
      {/* Image panel — soft neutral studio backdrop, rotated subtly across cards */}
      <div
        className="relative w-full aspect-square flex items-center justify-center"
        style={{ backgroundColor: STUDIO_BACKGROUNDS[index % STUDIO_BACKGROUNDS.length] }}
      >
        {showImage ? (
          <img
            src={imgSrc}
            alt={product.title}
            loading="lazy"
            onLoad={handleImgLoad}
            onError={tryNextImage}
            className="max-w-[88%] max-h-[78%] object-contain transition-transform duration-300 group-hover:scale-[1.03] drop-shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
          />
        ) : (
          <div className="text-neutral-400 text-xs">No image</div>
        )}
      </div>

      {/* Text area — clean, retail-catalog style */}
      <div className="px-3 py-3 bg-white">
        <h3 className="text-[13px] sm:text-sm font-medium text-neutral-800 leading-snug line-clamp-2 min-h-[2.5rem]">
          {product.title}
        </h3>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-base sm:text-lg font-bold text-neutral-900">
            ${price.toFixed(0)}
          </span>
          <span className="text-[11px] text-neutral-500">
            ≈ CDF {(price * exchangeRate).toLocaleString()}
          </span>
        </div>
      </div>
    </Link>
  );
}
