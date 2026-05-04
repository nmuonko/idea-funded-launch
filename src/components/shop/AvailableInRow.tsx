import { useLanguage } from '@/contexts/LanguageContext';

type Benefit = {
  emoji: string;
  titleFr: string;
  titleEn: string;
  subFr: string;
  subEn: string;
};

const BENEFITS: Benefit[] = [
  { emoji: '💰', titleFr: 'Prix tout inclus',     titleEn: 'All-inclusive prices', subFr: 'Aucun frais caché',    subEn: 'No hidden fees' },
  { emoji: '🚚', titleFr: 'Livraison au Congo',  titleEn: 'Delivery to Congo',     subFr: 'Rapide et fiable',     subEn: 'Fast & reliable' },
  { emoji: '🇺🇸', titleFr: 'Achat depuis les USA', titleEn: 'Sourced from the USA', subFr: 'Produits authentiques', subEn: 'Authentic products' },
  { emoji: '🟢', titleFr: 'Support WhatsApp',    titleEn: 'WhatsApp support',      subFr: 'Réponse rapide 7j/7',  subEn: 'Quick replies 7d/7' },
];

/**
 * Trust benefit strip — 4 horizontal items shown directly under the hero.
 */
export function AvailableInRow() {
  const { language } = useLanguage();
  const isFr = language === 'fr' || language === 'ln';

  return (
    <section className="px-3 sm:px-4 mt-3 mb-4" aria-label={isFr ? 'Nos engagements' : 'Why AfriShop'}>
      <div className="max-w-6xl mx-auto">
        <div className="rounded-2xl bg-white border border-black/[0.06] px-3 sm:px-5 py-3 sm:py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            {BENEFITS.map((b) => (
              <div key={b.titleEn} className="flex items-center gap-3">
                <span className="text-2xl sm:text-[26px] leading-none shrink-0" aria-hidden>
                  {b.emoji}
                </span>
                <div className="min-w-0">
                  <div className="text-[13px] sm:text-sm font-semibold text-neutral-900 truncate">
                    {isFr ? b.titleFr : b.titleEn}
                  </div>
                  <div className="text-[11px] sm:text-xs text-neutral-500 truncate">
                    {isFr ? b.subFr : b.subEn}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
