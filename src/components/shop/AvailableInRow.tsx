import { ChevronRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

type Country = {
  key: string;
  flag: string;
  nameEn: string;
  nameFr: string;
};

const COUNTRIES: Country[] = [
  { key: 'us', flag: '🇺🇸', nameEn: 'USA', nameFr: 'USA' },
  { key: 'tr', flag: '🇹🇷', nameEn: 'Turkey', nameFr: 'Turquie' },
  { key: 'cn', flag: '🇨🇳', nameEn: 'China', nameFr: 'Chine' },
  { key: 'cd', flag: '🇨🇩', nameEn: 'DR Congo', nameFr: 'RD Congo' },
];

/**
 * "Available in" country shipping row — Gazelle-style trust strip
 * shown directly under the hero banner.
 */
export function AvailableInRow() {
  const { language } = useLanguage();
  const isFr = language === 'fr' || language === 'ln';

  return (
    <section className="px-4 sm:px-6 mt-4 mb-5" aria-label={isFr ? 'Disponible dans' : 'Available in'}>
      <div className="container mx-auto max-w-6xl">
        <h2 className="text-sm font-semibold text-white/80 mb-2">
          {isFr ? 'Disponible dans' : 'Available in'}
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
          {COUNTRIES.map((c) => (
            <button
              key={c.key}
              type="button"
              className="group flex items-center gap-3 rounded-lg border border-white/12 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/20 transition px-3.5 py-3 text-left"
            >
              <span
                aria-hidden
                className="flex items-center justify-center w-9 h-7 rounded-[3px] bg-white/10 text-lg leading-none overflow-hidden shrink-0"
              >
                {c.flag}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-white truncate">
                  {isFr ? c.nameFr : c.nameEn}
                </span>
                <span className="block text-[11px] text-white/55">
                  {isFr ? 'Livraison rapide' : 'Fast delivery'}
                </span>
              </span>
              <ChevronRight className="w-4 h-4 text-white/40 group-hover:text-white/70 shrink-0" />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
