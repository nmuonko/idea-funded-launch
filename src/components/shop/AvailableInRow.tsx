import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSupportContact } from '@/hooks/useSupportContact';

type Benefit = {
  key: string;
  icon: React.ReactNode;
  titleFr: string;
  titleEn: string;
  subFr: string;
  subEn: string;
};

const WhatsAppIcon = () => (
  <span
    className="inline-flex items-center justify-center w-9 h-9 rounded-full"
    style={{ background: '#25D366' }}
    aria-hidden
  >
    <svg viewBox="0 0 32 32" className="w-5 h-5" fill="white">
      <path d="M19.11 17.41c-.27-.14-1.62-.8-1.87-.89-.25-.09-.43-.14-.61.14-.18.27-.7.89-.86 1.07-.16.18-.32.2-.59.07-.27-.14-1.16-.43-2.21-1.36-.82-.73-1.37-1.63-1.53-1.9-.16-.27-.02-.42.12-.55.12-.12.27-.32.41-.48.14-.16.18-.27.27-.45.09-.18.05-.34-.02-.48-.07-.14-.61-1.47-.84-2.02-.22-.53-.45-.46-.61-.47-.16-.01-.34-.01-.52-.01-.18 0-.48.07-.73.34-.25.27-.96.94-.96 2.29 0 1.36.98 2.66 1.12 2.84.14.18 1.93 2.95 4.68 4.13.65.28 1.16.45 1.56.58.65.21 1.25.18 1.72.11.52-.08 1.62-.66 1.85-1.3.23-.64.23-1.18.16-1.3-.07-.12-.25-.18-.52-.32zM16.03 5.33c-5.91 0-10.7 4.79-10.7 10.7 0 1.89.5 3.74 1.45 5.37L5.33 26.67l5.39-1.41c1.57.86 3.34 1.31 5.31 1.31 5.91 0 10.7-4.79 10.7-10.7 0-2.86-1.11-5.55-3.13-7.57a10.62 10.62 0 0 0-7.57-3.14z"/>
    </svg>
  </span>
);

/**
 * Trust benefit strip — 4 horizontal items shown directly under the hero.
 */
export function AvailableInRow() {
  const { language } = useLanguage();
  const { user } = useAuth();
  const { whatsappUrl } = useSupportContact();
  const isFr = language === 'fr' || language === 'ln';

  const BENEFITS: Benefit[] = [
    { key: 'price',    icon: <span className="text-2xl sm:text-[26px] leading-none shrink-0">💰</span>, titleFr: 'Prix tout inclus',     titleEn: 'All-inclusive prices', subFr: 'Aucun frais caché',     subEn: 'No hidden fees' },
    { key: 'delivery', icon: <span className="text-2xl sm:text-[26px] leading-none shrink-0">🚚</span>, titleFr: 'Livraison au Congo',  titleEn: 'Delivery to Congo',    subFr: 'Rapide et fiable',      subEn: 'Fast & reliable' },
    { key: 'usa',      icon: <span className="text-2xl sm:text-[26px] leading-none shrink-0">🇺🇸</span>, titleFr: 'Achat depuis les USA', titleEn: 'Sourced from the USA', subFr: 'Produits authentiques', subEn: 'Authentic products' },
    { key: 'wa',       icon: <WhatsAppIcon />,                                                            titleFr: 'Support WhatsApp',     titleEn: 'WhatsApp support',     subFr: 'Réponse rapide 7j/7',   subEn: 'Quick replies 7d/7' },
  ];

  return (
    <section className="px-3 sm:px-4 mt-3 mb-4" aria-label={isFr ? 'Nos engagements' : 'Why AfriShop'}>
      <div className="max-w-6xl mx-auto">
        <div className="rounded-2xl bg-white border border-black/[0.06] px-3 sm:px-5 py-3 sm:py-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            {BENEFITS.map((b) => {
              const content = (
                <>
                  {b.icon}
                  <div className="min-w-0">
                    <div className="text-[13px] sm:text-sm font-semibold text-neutral-900 truncate">
                      {isFr ? b.titleFr : b.titleEn}
                    </div>
                    <div className="text-[11px] sm:text-xs text-neutral-500 truncate">
                      {isFr ? b.subFr : b.subEn}
                    </div>
                  </div>
                </>
              );
              if (b.key === 'wa') {
                return (
                  <a
                    key={b.key}
                    href={whatsappUrl(user?.email)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                  >
                    {content}
                  </a>
                );
              }
              return (
                <div key={b.key} className="flex items-center gap-3">
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
