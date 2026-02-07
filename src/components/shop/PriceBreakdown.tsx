import { Info } from 'lucide-react';
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
}

export function PriceBreakdown({
  itemPriceUsd,
  quantity = 1,
  className,
  showDetails = true,
  serverTotal,
}: PriceBreakdownProps) {
  const { feeSettings } = useShopCart();
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = (t.shop || {}) as any;
  
  const subtotal = itemPriceUsd * quantity;
  
  // Use canonical shipping formula: base + (subtotal * percent)
  const shippingFee = calculateShippingUsd(
    subtotal,
    feeSettings.shippingBaseFeeUsd,
    feeSettings.shippingPercent
  );
  
  // Service fee: subtotal * markup percent (normalize if > 1)
  const markupRate = feeSettings.markupPercent > 1 
    ? feeSettings.markupPercent / 100 
    : feeSettings.markupPercent;
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

          <div className="border-t border-white/10 pt-3" />
        </>
      )}

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
    </div>
  );
}
