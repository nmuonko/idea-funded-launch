import { useLanguage } from '@/contexts/LanguageContext';
import { useShopCart, FeeSettings } from '@/contexts/ShopCartContext';
import { calculateShippingUsd } from '@/lib/shippingCalculation';
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
  const { addItem, feeSettings, exchangeRate } = useShopCart();
  const isFr = language === 'fr';

  const isVehicle = vehicleResult.isVehicle;

  // Calculate fees
  const markupPercent = isVehicle ? feeSettings.vehicleMarkupPercent : feeSettings.markupPercent;
  const markupFee = basePriceUsd * (markupPercent / 100);
  const shippingFee = isVehicle ? 0 : calculateShippingUsd(basePriceUsd, feeSettings.shippingBaseFeeUsd, feeSettings.shippingPercent);
  const totalUsd = isVehicle ? 0 : basePriceUsd + markupFee + shippingFee;
  const totalCdf = totalUsd * exchangeRate;

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
        requiresManualQuote: isVehicle,
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

      {/* Price breakdown */}
      <div className="px-4 pb-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{isFr ? 'Prix de base' : 'Base Price'}</span>
          <span className="text-foreground font-medium">${basePriceUsd.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            {isFr ? 'Frais de service' : 'Service Fee'}
          </span>
          <span className="text-foreground">${markupFee.toFixed(2)}</span>
        </div>

        {isVehicle ? (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{isFr ? 'Livraison' : 'Shipping'}</span>
              <span className="text-warning text-xs font-medium">
                {isFr ? 'Devis requis' : 'Quote Required'}
              </span>
            </div>
            <div className="border-t border-border/50 pt-2 mt-2">
              <div className="flex items-center gap-2 text-warning text-sm">
                <Car className="h-4 w-4" />
                <span>{isFr ? 'Véhicule détecté — un devis sera requis' : 'Vehicle detected — a quote will be required'}</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{isFr ? 'Livraison' : 'Shipping'}</span>
              <span className="text-foreground">${shippingFee.toFixed(2)}</span>
            </div>
            <div className="border-t border-border/50 pt-2 mt-2">
              <div className="flex justify-between text-base font-semibold">
                <span className="text-foreground">Total</span>
                <div className="text-right">
                  <div className="text-primary">${totalUsd.toFixed(2)}</div>
                  <div className="text-xs text-muted-foreground font-normal">
                    ≈ {Math.round(totalCdf).toLocaleString()} CDF
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 pb-4 flex gap-3">
        {isVehicle ? (
          <Button
            onClick={() => handleAddToCart(true)}
            className="flex-1 bg-warning hover:bg-warning/90 text-warning-foreground gap-2"
          >
            <Car className="h-4 w-4" />
            {isFr ? 'Demander un devis' : 'Request a Quote'}
          </Button>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
