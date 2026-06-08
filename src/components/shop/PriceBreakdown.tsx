import { Info, Car } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useShopCart } from '@/contexts/ShopCartContext';
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
  productTitle?: string;
  productCategoryKey?: string | null;
  /** When set, displays deposit breakdown: this amount is due now (30%), remainder shown as balance on arrival. */
  depositDueNowUsd?: number | null;
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
  productTitle,
  productCategoryKey,
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

  // All prices from the backend are already all-inclusive (fees_included: true).
  // Display them directly — no local re-calculation of markup/shipping.
  const total = itemPriceUsd * quantity;

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
