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
  depositDueNowUsd,
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
        <DepositOrTotal
          total={fixedTotal}
          depositDueNowUsd={depositDueNowUsd ?? null}
          isFr={language === 'fr'}
          fallbackLabel={shop.total || 'Total'}
        />

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
      <DepositOrTotal
        total={total}
        depositDueNowUsd={depositDueNowUsd ?? null}
        isFr={language === 'fr'}
        fallbackLabel={shop.total || 'Total'}
      />

    </div>
  );
}

function DepositOrTotal({
  total,
  depositDueNowUsd,
  isFr,
  fallbackLabel,
}: {
  total: number;
  depositDueNowUsd: number | null;
  isFr: boolean;
  fallbackLabel: string;
}) {
  if (depositDueNowUsd != null && depositDueNowUsd > 0 && depositDueNowUsd < total) {
    const balance = Math.max(0, total - depositDueNowUsd);
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/60">{isFr ? 'Total commande' : 'Order total'}</span>
          <span className="text-white/80">${total.toFixed(2)}</span>
        </div>
        <div className="rounded-xl border border-blue-400/30 bg-blue-500/10 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-white">
              {isFr ? 'À payer maintenant' : 'Due now'}
              <span className="ml-1 text-xs text-white/60">(30%)</span>
            </span>
            <span className="text-xl font-bold text-white whitespace-nowrap">
              ${depositDueNowUsd.toFixed(2)}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-3 text-xs">
            <span className="text-white/55">
              {isFr ? 'Solde à l’arrivée' : 'Balance on arrival'}
              <span className="ml-1 text-white/40">(70%)</span>
            </span>
            <span className="text-white/70 whitespace-nowrap">${balance.toFixed(2)}</span>
          </div>
        </div>
      </div>
    );

  }
  return (
    <div className="flex items-center justify-between">
      <span className="text-white font-medium">{fallbackLabel}</span>
      <span className="text-xl font-bold text-white">${total.toFixed(2)}</span>
    </div>
  );
}

