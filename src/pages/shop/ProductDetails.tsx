import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ShoppingCart, Check, Loader2, ExternalLink, ChevronLeft, ChevronRight, Heart } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { BottomNavigation } from '@/components/shop/BottomNavigation';
import { PriceBreakdown } from '@/components/shop/PriceBreakdown';
import { ProductGrid } from '@/components/shop/ProductGrid';
import { Product } from '@/components/shop/ProductCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useShopCart } from '@/contexts/ShopCartContext';
import { supabase } from '@/integrations/supabase/client';

interface ProductDetails {
  id: string;
  provider: string;
  title: string;
  description?: string;
  images: string[];
  priceUsd: number;
  rating?: number;
  reviewCount?: number;
  inStock: boolean;
  productUrl?: string;
  brand?: string;
}

export default function ProductDetailsPage() {
  const { provider, id } = useParams<{ provider: string; id: string }>();
  const { addItem } = useShopCart();
  
  const [product, setProduct] = useState<ProductDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [similarProducts, setSimilarProducts] = useState<Product[]>([]);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    const fetchProduct = async () => {
      if (!provider || !id) return;
      
      try {
        setLoading(true);
        setError(null);

        // Decode and normalize the product ID
        const productIdDecoded = decodeURIComponent(id);
        const lowerProvider = provider.toLowerCase();
        const lowerProductId = productIdDecoded.toLowerCase();
        
        // Strip redundant provider prefix if ID starts with provider name
        let cleanProductId = productIdDecoded;
        if (lowerProvider === 'ebay' && lowerProductId.startsWith('ebay_')) {
          cleanProductId = productIdDecoded.slice(5);
        } else if (lowerProvider === 'ebay' && lowerProductId.startsWith('ebay:')) {
          cleanProductId = productIdDecoded.slice(5);
        } else if ((lowerProvider === 'rainforest' || lowerProvider === 'amazon') && lowerProductId.startsWith('amazon_')) {
          cleanProductId = productIdDecoded.slice(7);
        } else if (lowerProvider === 'rainforest' && lowerProductId.startsWith('rainforest_')) {
          cleanProductId = productIdDecoded.slice(11);
        }
        
        // Build the full product ID in format "provider:productId"
        const fullId = `${provider}:${cleanProductId}`;
        
        // Use GET request with query params (catalog-product expects this)
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/catalog-product?id=${encodeURIComponent(fullId)}`,
          {
            headers: {
              'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              'Content-Type': 'application/json',
            },
          }
        );
        
        const data = await response.json();
        
        if (!response.ok || data.status === 'error') {
          throw new Error(data.error?.message || 'Product not found');
        }
        
        if (!data?.item) throw new Error('Product not found');

        const item = data.item;
        setProduct({
          id: item.provider_product_id || item.id,
          provider: item.provider || provider,
          title: item.title || 'Product',
          description: item.description,
          images: item.images || item.imageUrls || (item.image_url ? [item.image_url] : ['/placeholder.svg']),
          priceUsd: item.price_usd || item.priceUsd || 0,
          rating: item.rating,
          reviewCount: item.review_count || item.reviewCount,
          inStock: item.in_stock !== false,
          productUrl: item.product_url || item.productUrl,
          brand: item.brand,
        });

        // Fetch similar products
        if (item.title) {
          const keywords = item.title.split(' ').slice(0, 3).join(' ');
          const similarResponse = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/catalog-search?q=${encodeURIComponent(keywords)}&limit=5`,
            {
              headers: {
                'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              },
            }
          );
          const similarData = await similarResponse.json();
          
          if (similarData?.items) {
            setSimilarProducts(
              similarData.items
                .filter((i: any) => (i.provider_product_id || i.id) !== (item.provider_product_id || item.id))
                .slice(0, 4)
                .map((i: any) => ({
                  id: i.provider_product_id || i.id,
                  provider: i.provider || 'amazon',
                  title: i.title || 'Product',
                  imageUrl: i.image_url || '',
                  priceUsd: i.price_usd || 0,
                  rating: i.rating,
                  productUrl: i.product_url,
                }))
            );
          }
        }
      } catch (err: any) {
        console.error('Failed to fetch product:', err);
        setError(err.message || 'Failed to load product');
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [provider, id]);

  const handleAddToCart = async () => {
    if (!product) return;
    
    setAdding(true);
    try {
      await addItem({
        productId: product.id,
        provider: product.provider,
        title: product.title,
        imageUrl: product.images[0] || '',
        priceUsd: product.priceUsd,
        quantity,
        productUrl: product.productUrl,
      });
      setAdded(true);
      setTimeout(() => setAdded(false), 3000);
    } finally {
      setAdding(false);
    }
  };

  const nextImage = () => {
    if (!product) return;
    setCurrentImageIndex((prev) => (prev + 1) % product.images.length);
  };

  const prevImage = () => {
    if (!product) return;
    setCurrentImageIndex((prev) => (prev - 1 + product.images.length) % product.images.length);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black">
        <ShopHeader />
        <div className="pt-24 px-4">
          <div className="container mx-auto max-w-6xl">
            <div className="grid lg:grid-cols-2 gap-8">
              <Skeleton className="aspect-square rounded-2xl bg-white/10" />
              <div className="space-y-4">
                <Skeleton className="h-8 w-3/4 bg-white/10" />
                <Skeleton className="h-6 w-1/4 bg-white/10" />
                <Skeleton className="h-32 w-full bg-white/10" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="min-h-screen bg-black">
        <ShopHeader />
        <div className="pt-24 px-4 text-center">
          <p className="text-red-400 mb-4">{error || 'Product not found'}</p>
          <Link to="/shop">
            <Button variant="outline" className="border-white/20 text-white hover:bg-white/10">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Shop
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const providerColor = product.provider === 'amazon'
    ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    : 'bg-blue-500/20 text-blue-400 border-blue-500/30';

  return (
    <div className="min-h-screen bg-black">
      <ShopHeader />

      <main className="pt-24 px-4 pb-20">
        <div className="container mx-auto max-w-6xl">
          {/* Back Button */}
          <Link 
            to="/shop" 
            className="inline-flex items-center gap-2 text-white/60 hover:text-white mb-6 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Shop
          </Link>

          <div className="grid lg:grid-cols-2 gap-8 lg:gap-12">
            {/* Image Gallery */}
            <div className="space-y-4">
              <div className="relative aspect-square bg-white/5 rounded-2xl overflow-hidden border border-white/10">
                <AnimatePresence mode="wait">
                  <motion.img
                    key={currentImageIndex}
                    src={product.images[currentImageIndex] || '/placeholder.svg'}
                    alt={product.title}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="w-full h-full object-contain p-8"
                  />
                </AnimatePresence>

                {product.images.length > 1 && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={prevImage}
                      className="absolute left-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/50 text-white hover:bg-black/70"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={nextImage}
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full bg-black/50 text-white hover:bg-black/70"
                    >
                      <ChevronRight className="h-5 w-5" />
                    </Button>
                  </>
                )}

                <Badge variant="outline" className={`absolute top-4 left-4 capitalize ${providerColor}`}>
                  {product.provider}
                </Badge>
              </div>

              {/* Thumbnails */}
              {product.images.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {product.images.slice(0, 6).map((img, index) => (
                    <button
                      key={index}
                      onClick={() => setCurrentImageIndex(index)}
                      className={`flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                        index === currentImageIndex
                          ? 'border-blue-500'
                          : 'border-white/10 hover:border-white/30'
                      }`}
                    >
                      <img
                        src={img}
                        alt={`${product.title} ${index + 1}`}
                        className="w-full h-full object-contain bg-white/5 p-1"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Product Info */}
            <div className="space-y-6">
              {product.brand && (
                <p className="text-sm text-white/60 uppercase tracking-wider">
                  {product.brand}
                </p>
              )}

              <h1 className="text-2xl md:text-3xl font-bold text-white">
                {product.title}
              </h1>

              {/* Rating */}
              {product.rating && (
                <div className="flex items-center gap-2">
                  <div className="flex items-center">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <span
                        key={i}
                        className={i < Math.round(product.rating!) ? 'text-yellow-400' : 'text-white/20'}
                      >
                        ★
                      </span>
                    ))}
                  </div>
                  <span className="text-white/60">
                    {product.rating.toFixed(1)}
                    {product.reviewCount && ` (${product.reviewCount} reviews)`}
                  </span>
                </div>
              )}

              {/* Stock Status */}
              {product.inStock ? (
                <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                  In Stock
                </Badge>
              ) : (
                <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                  Out of Stock
                </Badge>
              )}

              {/* Price Breakdown */}
              <div className="bg-white/5 rounded-2xl p-6 border border-white/10">
                <PriceBreakdown 
                  itemPriceUsd={product.priceUsd} 
                  quantity={quantity}
                />
              </div>

              {/* Quantity Selector */}
              <div className="flex items-center gap-4">
                <span className="text-white/70">Quantity:</span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="h-8 w-8 p-0 border-white/20 text-white hover:bg-white/10"
                  >
                    -
                  </Button>
                  <span className="text-white w-8 text-center">{quantity}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setQuantity(quantity + 1)}
                    className="h-8 w-8 p-0 border-white/20 text-white hover:bg-white/10"
                  >
                    +
                  </Button>
                </div>
              </div>

              {/* Add to Cart */}
              <Button
                onClick={handleAddToCart}
                disabled={adding || !product.inStock}
                className={`w-full h-14 text-lg rounded-full transition-all ${
                  added
                    ? 'bg-green-500 hover:bg-green-600'
                    : 'bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600'
                }`}
              >
                {adding ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : added ? (
                  <>
                    <Check className="h-5 w-5 mr-2" />
                    Added to Cart
                  </>
                ) : (
                  <>
                    <ShoppingCart className="h-5 w-5 mr-2" />
                    Add to Cart
                  </>
                )}
              </Button>

              {/* View Original */}
              {product.productUrl && (
                <a
                  href={product.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 text-sm text-white/60 hover:text-white transition-colors"
                >
                  <ExternalLink className="h-4 w-4" />
                  View on {product.provider}
                </a>
              )}

              {/* Description */}
              {product.description && (
                <div className="pt-6 border-t border-white/10">
                  <h3 className="text-lg font-semibold text-white mb-3">Description</h3>
                  <p className="text-white/70 whitespace-pre-line">{product.description}</p>
                </div>
              )}
            </div>
          </div>

          {/* Similar Products */}
          {similarProducts.length > 0 && (
            <section className="mt-16">
              <h2 className="text-xl font-bold text-white mb-6">Similar Products</h2>
              <ProductGrid products={similarProducts} />
            </section>
          )}
        </div>
      </main>
      <BottomNavigation />
    </div>
  );
}
