import { useEffect, useState } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { refreshCartLocks, type LockLine } from "@/lib/priceLock";

/**
 * Hook used by ShopCart on mount: refreshes any expired price locks
 * silently in the background and surfaces a soft toast if any item
 * needed a price refresh or is now unavailable.
 *
 * Returns the per-item lock map so the cart can render countdowns.
 */
export function useCartLockRefresh(orderId: string | null | undefined) {
  const { language } = useLanguage();
  const { toast } = useToast();
  const [locks, setLocks] = useState<Record<string, LockLine>>({});

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;

    (async () => {
      const res = await refreshCartLocks(orderId);
      if (cancelled || !res) return;

      const map: Record<string, LockLine> = {};
      for (const l of res.items) map[l.itemId] = l;
      setLocks(map);

      if (res.unavailableCount > 0) {
        toast({
          variant: "destructive",
          title: language === "fr" ? "Article indisponible" : "Item unavailable",
          description:
            language === "fr"
              ? "Un article de votre panier n'est plus disponible."
              : "An item in your cart is no longer available.",
        });
      } else if (res.expiredCount > 0) {
        toast({
          title: language === "fr" ? "Prix actualisé" : "Price refreshed",
          description:
            language === "fr"
              ? "Nous avons actualisé le prix avant le paiement."
              : "We refreshed the price before payment.",
        });
      }
    })();

    return () => { cancelled = true; };
  }, [orderId]);

  return locks;
}
