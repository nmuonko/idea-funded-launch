import { Info, Car } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useShopCart } from '@/contexts/ShopCartContext';
import { calculateShippingUsd, calculateWeightBasedShipping } from '@/lib/shippingCalculation';
import { detectShippingCategory } from '@/lib/shippingCategoryDetector';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

interface PriceBreakdownProps {
  itemPriceUsd: number;
  quantity?: number;
  className?: string;
  showDetails?: boolean;
  serverTotal?: number | null;
  isVehicle?: boolean;
  isFixedPrice?: boolean;
  context?: 'product-detail' | 'cart';
  serverMarginUsd?: number;
  serverShippingUsd?: number;
  serverLineTotalUsd?: number;
  
}

export function PriceBreakdown({
  itemPriceUsd,
  quantity = 1,
  className,
  showDetails = true,
  serverTotal,
  isVehicle = false,
  isFixedPrice = false,
  context,
  serverMarginUsd,
  serverShippingUsd,
  serverLineTotalUsd,
  
}: PriceBreakdownProps) {
  const ctx = context ?? 'cart';
  const { feeSettings, hasVehicleItems, vehicleQuoteStatus } = useShopCart();
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = (t.shop || {}) as any;
  
  // Show skeleton when price hasn't loaded yet
  if (itemPriceUsd === 0 && serverTotal == null) {
    return (
      <div className={cn("space-y-3", className)}>
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/60">{shop.orderSummaryItem || 'Item'}</span>
          <span className="text-white/40">—</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/60">{shop.markupFee || 'Markup Fee'}</span>
          <span className="text-white/40">—</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/60">{shop.shippingFee || 'Shipping Fee'}</span>
          <span className="text-white/40">—</span>
        </div>
        <div className="border-t border-white/10 pt-3" />
        <div className="flex items-center justify-between">
          <span className="text-white font-medium">{shop.estimatedTotal || 'Estimated Total'}</span>
          <span className="text-white/40 text-xl font-bold">—</span>
        </div>
      </div>
    );
  }

  // Fixed-price items (hot products): show only the total, no markup/shipping breakdown
  if (isFixedPrice) {
    const fixedTotal = itemPriceUsd * quantity;
    return (
      <div className={cn("space-y-3", className)}>
        {showDetails && (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/60 min-w-0">
                {shop.orderSummaryItem || 'Item'}{quantity > 1 ? ` (×${quantity})` : ''}
              </span>
              <span className="text-white/90 flex-shrink-0">${fixedTotal.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/60">{shop.markupFee || 'Markup Fee'}</span>
              <span className="text-green-400 text-xs">{language === 'fr' ? 'Inclus' : 'Included'}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/60">{shop.shippingFee || 'Shipping Fee'}</span>
              <span className="text-green-400 text-xs">{language === 'fr' ? 'Inclus' : 'Included'}</span>
            </div>
            <div className="border-t border-white/10 pt-3" />
          </>
        )}
        <div className="flex items-center justify-between">
          <span className="text-white font-medium">{shop.total || 'Total'}</span>
          <span className="text-xl font-bold text-white">${fixedTotal.toFixed(2)}</span>
        </div>
      </div>
    );
  }

  const subtotal = itemPriceUsd * quantity;

  // Vehicles now use tiered auto-pricing — show simplified all-inclusive view
  const showSimplifiedAllInclusive = !isVehicle || (isVehicle && ctx === 'product-detail');
  
  // Use vehicle markup for vehicle products, general markup otherwise
  const effectiveMarkupPercent = isVehicle
    ? feeSettings.vehicleMarkupPercent
    : feeSettings.markupPercent;
  
  // Use canonical shipping formula: base + (subtotal * percent)
  const calculatedShippingFee = isVehicle ? 0 : calculateShippingUsd(
    subtotal,
    feeSettings.shippingBaseFeeUsd,
    feeSettings.shippingPercent
  );
  
  // Service fee: subtotal * markup percent (normalize if > 1)
  const markupRate = effectiveMarkupPercent > 1 
    ? effectiveMarkupPercent / 100 
    : effectiveMarkupPercent;
  const calculatedServiceFee = isVehicle ? 0 : Math.round(subtotal * markupRate * 100) / 100;
  
  // Use server values for quoted vehicles, calculated values otherwise
  const hasServerBreakdown = isVehicle && (serverMarginUsd != null || serverShippingUsd != null);
  const serviceFee = hasServerBreakdown ? (serverMarginUsd ?? calculatedServiceFee) : calculatedServiceFee;
  const shippingFee = hasServerBreakdown ? (serverShippingUsd ?? calculatedShippingFee) : calculatedShippingFee;
  const total = hasServerBreakdown 
    ? (serverLineTotalUsd ?? (subtotal + serviceFee + shippingFee))
    : (subtotal + calculatedShippingFee + calculatedServiceFee);

  // For vehicles, import and calculate using tiered pricing
  // For non-vehicle items: show simplified all-inclusive view

  // Simplified all-inclusive view for regular products
  if (showSimplifiedAllInclusive) {
    return (
      <div className={cn("space-y-3", className)}>
        {showDetails && (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/60 min-w-0">
                {shop.orderSummaryItem || 'Item'}{quantity > 1 ? ` (×${quantity})` : ''}
              </span>
              <span className="text-white/90 flex-shrink-0">${total.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/60">{shop.markupFee || 'Service Fee'}</span>
              <span className="text-green-400 text-xs">{language === 'fr' ? 'Inclus' : 'Included'}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/60">{shop.shippingFee || 'Shipping'}</span>
              <span className="text-green-400 text-xs">{language === 'fr' ? 'Inclus' : 'Included'}</span>
            </div>
            <div className="border-t border-white/10 pt-3" />
          </>
        )}
        <div className="flex items-center justify-between">
          <span className="text-white font-medium">{shop.total || 'Total'}</span>
          <span className="text-xl font-bold text-white">${total.toFixed(2)}</span>
        </div>
      </div>
    );
  }

  // Fallback: full breakdown (shouldn't normally reach here with current logic)
  return (
    <div className={cn("space-y-3", className)}>
      {showDetails && (
        <>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/60 min-w-0">
              {shop.orderSummaryItem || 'Item'}{quantity > 1 ? ` (×${quantity})` : ''}
            </span>
            <span className="text-white/90 flex-shrink-0">${subtotal.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/60">{shop.markupFee || 'Service Fee'}</span>
            <span className="text-green-400 text-xs">{language === 'fr' ? 'Inclus' : 'Included'}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-white/60">{shop.shippingFee || 'Shipping'}</span>
            <span className="text-green-400 text-xs">{language === 'fr' ? 'Inclus' : 'Included'}</span>
          </div>
          <div className="border-t border-white/10 pt-3" />
        </>
      )}
      <div className="flex items-center justify-between">
        <span className="text-white font-medium">{shop.total || 'Total'}</span>
        <span className="text-xl font-bold text-white">${total.toFixed(2)}</span>
      </div>
    </div>
  );
}
