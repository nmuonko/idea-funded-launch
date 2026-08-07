import { useState, useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useShopCart } from '@/contexts/ShopCartContext';
import { resolveDisplayPrice } from '@/lib/serverPricing';
import { vehicleAllInclusivePrice } from '@/lib/vehiclePricing';
import { VehicleDetectionResult } from '@/lib/vehicleDetection';
import { ShoppingCart, Zap, Car } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

interface PasteBreakdownCardProps {
  productTitle: string;
  productImageUrl: string | null;
  basePriceUsd: number;
  productUrl: string;
  store: string;
  vehicleResult: VehicleDetectionResult;
}

export function PasteBreakdownCard({
  productTitle,
  productImageUrl,
  basePriceUsd,
  productUrl,
  store,
  vehicleResult,
}: PasteBreakdownCardProps) {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const { addItem, exchangeRate } = useShopCart();
  const isFr = language === 'fr';

  const isVehicle = vehicleResult.isVehicle;

  // Server-computed price
  const [totalUsd, setTotalUsd] = useState<number | null>(null);

  useEffect(() => {
    if (isVehicle) {
      setTotalUsd(vehicleAllInclusivePrice(basePriceUsd));
    } else {
      resolveDisplayPrice(basePriceUsd, productTitle).then(setTotalUsd);
    }
  }, [basePriceUsd, isVehicle]);

  const totalCdf = (totalUsd ?? 0) * exchangeRate;

  const handleAddToCart = async (buyNow = false) => {
    try {
      await addItem({
        productId: productUrl,
        provider: store,
        title: productTitle,
        imageUrl: productImageUrl || '',
        priceUsd: basePriceUsd,
        quantity: 1,
        productUrl,
        isVehicle,
        requiresManualQuote: false,
      });
      toast.success(isFr ? 'Ajouté au panier' : 'Added to cart');
      if (buyNow) {
        navigate('/cart');
      }
    } catch (e) {
      toast.error(isFr ? 'Erreur lors de l\'ajout' : 'Failed to add to cart');
    }
  };

  return (
    <div className="rounded-2xl border border-border/50 bg-card overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Product preview */}
      <div className="flex gap-4 p-4">
        {productImageUrl && (
          <img
            src={productImageUrl}
            alt={productTitle}
            className="w-20 h-20 rounded-xl object-cover bg-muted flex-shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground line-clamp-2">{productTitle}</p>
          <p className="text-xs text-muted-foreground mt-1">{store}</p>
        </div>
      </div>

      <div className="px-4 pb-4 space-y-2">
        <>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{isFr ? 'Prix total' : 'Total Price'}</span>
            <span className="text-foreground font-medium">{totalUsd != null ? `$${totalUsd.toFixed(2)}` : '…'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{isFr ? 'Frais de service' : 'Service Fee'}</span>
            <span className="text-green-500 text-xs">{isFr ? 'Inclus' : 'Included'}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{isFr ? 'Livraison' : 'Shipping'}</span>
            <span className="text-green-500 text-xs">{isFr ? 'Inclus' : 'Included'}</span>
          </div>
          {isVehicle && (
            <div className="flex items-center gap-2 text-amber-400 text-xs mt-1">
              <Car className="h-3.5 w-3.5" />
              <span>{isFr ? 'Véhicule détecté — frais inclus' : 'Vehicle detected — fees included'}</span>
            </div>
          )}
          <div className="border-t border-border/50 pt-2 mt-2">
            <div className="flex justify-between text-base font-semibold">
              <span className="text-foreground">Total</span>
              <div className="text-right">
                <div className="text-primary">{totalUsd != null ? `$${totalUsd.toFixed(2)}` : '…'}</div>
              </div>
            </div>
          </div>
        </>
      </div>

      {/* Actions */}
      <div className="px-4 pb-4 flex gap-3">
        <Button
          onClick={() => handleAddToCart(false)}
          variant="outline"
          className="flex-1 gap-2"
        >
          <ShoppingCart className="h-4 w-4" />
          {isFr ? 'Ajouter au panier' : 'Add to Cart'}
        </Button>
        <Button
          onClick={() => handleAddToCart(true)}
          className="flex-1 gap-2 bg-primary hover:bg-primary/90"
        >
          <Zap className="h-4 w-4" />
          {isFr ? 'Acheter' : 'Buy Now'}
        </Button>
      </div>
    </div>
  );
}
