import { Info } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useShopCart } from '@/contexts/ShopCartContext';
import { calculateShippingUsd } from '@/lib/shippingCalculation';

interface PriceBreakdownProps {
  itemPriceUsd: number;
  quantity?: number;
  className?: string;
  showDetails?: boolean;
}

export function PriceBreakdown({
  itemPriceUsd,
  quantity = 1,
  className,
  showDetails = true,
}: PriceBreakdownProps) {
  const { feeSettings } = useShopCart();
  
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
              Item{quantity > 1 ? ` (×${quantity})` : ''}
            </span>
            <span className="text-white/90">${subtotal.toFixed(2)}</span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-white/60 flex items-center gap-1">
              Shipping & Import
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-3 w-3 text-white/40" />
                </TooltipTrigger>
                <TooltipContent className="bg-black/90 text-white border-white/10">
                  <p>International shipping and customs handling</p>
                </TooltipContent>
              </Tooltip>
            </span>
            <span className="text-white/90">${shippingFee.toFixed(2)}</span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-white/60 flex items-center gap-1">
              Service Fee
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-3 w-3 text-white/40" />
                </TooltipTrigger>
                <TooltipContent className="bg-black/90 text-white border-white/10">
                  <p>Personal shopping and procurement service</p>
                </TooltipContent>
              </Tooltip>
            </span>
            <span className="text-white/90">${serviceFee.toFixed(2)}</span>
          </div>

          <div className="border-t border-white/10 pt-3" />
        </>
      )}

      <div className="flex items-center justify-between">
        <span className="text-white font-medium">Estimated Total</span>
        <span className="text-xl font-bold text-white">${total.toFixed(2)}</span>
      </div>

      <p className="text-xs text-white/40">
        Final price may vary based on item weight and destination
      </p>
    </div>
  );
}
