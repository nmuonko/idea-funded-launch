import { Info, Car } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useShopCart } from '@/contexts/ShopCartContext';
import { calculateShippingUsd } from '@/lib/shippingCalculation';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

interface PriceBreakdownProps {
  itemPriceUsd: number;
  quantity?: number;
  className?: string;
  showDetails?: boolean;
  serverTotal?: number | null;
  isVehicle?: boolean;
}

export function PriceBreakdown({
  itemPriceUsd,
  quantity = 1,
  className,
  showDetails = true,
  serverTotal,
  isVehicle = false,
}: PriceBreakdownProps) {
  const { feeSettings, hasVehicleItems, vehicleQuoteStatus } = useShopCart();
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = (t.shop || {}) as any;
  
  const subtotal = itemPriceUsd * quantity;
  
  // Determine if this specific product or cart has vehicles pending quote
  const vehiclePendingQuote = isVehicle
    ? vehicleQuoteStatus !== 'quoted'
    : hasVehicleItems && vehicleQuoteStatus !== 'quoted';
  
  // Use vehicle markup for vehicle products, general markup otherwise
  const effectiveMarkupPercent = isVehicle
    ? feeSettings.vehicleMarkupPercent
    : feeSettings.markupPercent;
  
  // Use canonical shipping formula: base + (subtotal * percent)
  const shippingFee = calculateShippingUsd(
    subtotal,
    feeSettings.shippingBaseFeeUsd,
    feeSettings.shippingPercent
  );
  
  // Service fee: subtotal * markup percent (normalize if > 1)
  const markupRate = effectiveMarkupPercent > 1 
    ? effectiveMarkupPercent / 100 
    : effectiveMarkupPercent;
  const serviceFee = Math.round(subtotal * markupRate * 100) / 100;
  
  const total = subtotal + shippingFee + serviceFee;

  return (
    <div className={cn("space-y-3", className)}>
      {showDetails && (
        <>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/60">
              {shop.orderSummaryItem || 'Item'}{quantity > 1 ? ` (×${quantity})` : ''}
            </span>
            <span className="text-white/90">${subtotal.toFixed(2)}</span>
          </div>

          {vehiclePendingQuote ? (
            <>
              {/* Show vehicle markup with correct percentage */}
              {isVehicle && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/60 flex items-center gap-1">
                    {shop.markupFee || 'Markup Fee'}
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-3 w-3 text-white/40" />
                      </TooltipTrigger>
                      <TooltipContent className="bg-black/90 text-white border-white/10">
                        <p>{language === 'fr' ? `Frais de service véhicule (${effectiveMarkupPercent}%)` : `Vehicle service fee (${effectiveMarkupPercent}%)`}</p>
                      </TooltipContent>
                    </Tooltip>
                  </span>
                  <span className="text-white/90">${serviceFee.toFixed(2)}</span>
                </div>
              )}

              {/* Non-vehicle items in a mixed cart: mask markup */}
              {!isVehicle && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-white/60 flex items-center gap-1">
                    {shop.markupFee || 'Markup Fee'}
                  </span>
                  <span className="text-amber-400 text-xs italic">
                    {language === 'fr' ? 'Inclus dans le devis' : 'Included in quote'}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between text-sm">
                <span className="text-white/60 flex items-center gap-1">
                  {shop.shippingFee || 'Shipping Fee'}
                </span>
                <span className="text-amber-400 text-xs italic">
                  {language === 'fr' ? 'En attente du devis' : 'Awaiting quote'}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/60 flex items-center gap-1">
                  {shop.markupFee || 'Markup Fee'}
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-white/40" />
                    </TooltipTrigger>
                    <TooltipContent className="bg-black/90 text-white border-white/10">
                      <p>{shop.markupFeeTooltip || 'Personal shopping and procurement service'}</p>
                    </TooltipContent>
                  </Tooltip>
                </span>
                <span className="text-white/90">${serviceFee.toFixed(2)}</span>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-white/60 flex items-center gap-1">
                  {shop.shippingFee || 'Shipping Fee'}
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-white/40" />
                    </TooltipTrigger>
                    <TooltipContent className="bg-black/90 text-white border-white/10">
                      <p>{shop.shippingFeeTooltip || 'International shipping and customs handling'}</p>
                    </TooltipContent>
                  </Tooltip>
                </span>
                <span className="text-white/90">${shippingFee.toFixed(2)}</span>
              </div>
            </>
          )}

          <div className="border-t border-white/10 pt-3" />
        </>
      )}

      {vehiclePendingQuote ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-white font-medium">
              {isVehicle
                ? (language === 'fr' ? 'Sous-total estimé' : 'Estimated Subtotal')
                : (language === 'fr' ? 'Sous-total articles' : 'Item Subtotal')}
            </span>
            <span className="text-xl font-bold text-white">
              ${isVehicle ? (subtotal + serviceFee).toFixed(2) : subtotal.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-amber-400 text-xs">
            <Car className="h-3.5 w-3.5 flex-shrink-0" />
            <span>
              {language === 'fr' 
                ? 'Les frais de livraison seront déterminés après le devis'
                : 'Shipping will be determined after admin quote'}
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-white font-medium">
              {serverTotal != null ? (shop.total || 'Total') : (shop.estimatedTotal || 'Estimated Total')}
            </span>
            <span className="text-xl font-bold text-white">
              ${(serverTotal != null ? serverTotal : total).toFixed(2)}
            </span>
          </div>

          {serverTotal == null && (
            <p className="text-xs text-white/40">
              {shop.priceDisclaimer || 'Final price may vary based on item weight and destination'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
