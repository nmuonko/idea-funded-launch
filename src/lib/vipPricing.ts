/**
 * VIP pricing formula — client-side PREVIEW ONLY.
 * The authoritative calculation runs server-side in the vip-ai-process
 * edge function. This mirror exists so the admin UI can show a live
 * price preview while editing batch details.
 *
 * Formula (per spec):
 *   shipping  = weightKg × ratePerKg
 *   buffer    = shipping × bufferPct / 100
 *   profit    = purchasePrice × markupPct / 100   (markup on purchase price ONLY)
 *   final     = purchasePrice + shipping + buffer + profit  (2 dp)
 */

export interface VipPriceBreakdown {
  shippingCost: number;
  shippingBuffer: number;
  profit: number;
  finalPrice: number;
}

export function computeVipPrice(
  purchasePrice: number,
  weightKg: number,
  ratePerKg: number,
  bufferPct: number,
  markupPct: number,
): VipPriceBreakdown {
  // Integer-cents math to avoid floating point drift
  const purchaseCents = Math.round(purchasePrice * 100);
  const shippingCents = Math.round(weightKg * ratePerKg * 100);
  const bufferCents = Math.round((shippingCents * bufferPct) / 100);
  const profitCents = Math.round((purchaseCents * markupPct) / 100);
  return {
    shippingCost: shippingCents / 100,
    shippingBuffer: bufferCents / 100,
    profit: profitCents / 100,
    finalPrice: (purchaseCents + shippingCents + bufferCents + profitCents) / 100,
  };
}
