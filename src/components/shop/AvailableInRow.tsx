import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';

type Country = {
  key: string;
  /** ISO 3166-1 alpha-2 code for SVG flag, or null for emoji fallback */
  iso?: string;
  emoji?: string;
  nameEn: string;
  nameFr: string;
  /** Route or in-page action when clicked */
  href?: string;
  scrollToId?: string;
};

/**
 * Source countries that AfriShop ships from + Hot Products quick link.
 * Flags use flagcdn.com SVGs for cross-platform consistency (Windows Chrome
 * does not render regional-indicator emoji flags as actual flags).
 */
const COUNTRIES: Country[] = [
  { key: 'us',  iso: 'us', nameEn: 'USA',          nameFr: 'USA',              scrollToId: 'shop-categories-anchor' },
  { key: 'tr',  iso: 'tr', nameEn: 'Turkey',       nameFr: 'Turquie',          href: '/shop/turkey' },
  { key: 'cn',  iso: 'cn', nameEn: 'China',        nameFr: 'Chine',            href: '/shop/china' },
  { key: 'hot', emoji: '🔥', nameEn: 'Hot Products', nameFr: 'Produits Vedettes', href: '/hot-products' },
];

/**
 * "Shop by country" — clean clickable country tiles under the hero.
 * No arrows, no clutter — just flag + name + delivery line.
 */
export function AvailableInRow() {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const isFr = language === 'fr' || language === 'ln';

  const handleClick = (c: Country) => {
    if (c.scrollToId) {
      const el = document.getElementById(c.scrollToId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    }
    if (c.href) navigate(c.href);
  };

  return (
    <section
      className="px-4 sm:px-6 mt-4 mb-5"
      aria-label={isFr ? 'Acheter par pays' : 'Shop by country'}
    >
      <div className="container mx-auto max-w-6xl">
        <h2 className="text-sm font-semibold text-white/85 mb-2.5 tracking-tight">
          {isFr ? 'Acheter par pays' : 'Shop by country'}
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
          {COUNTRIES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => handleClick(c)}
              aria-label={isFr ? `Acheter depuis ${c.nameFr}` : `Shop from ${c.nameEn}`}
              className="group flex items-center gap-3 rounded-xl border border-white/12 bg-white/[0.03] hover:bg-primary/10 hover:border-primary/40 transition-all px-3.5 py-3 text-left active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
            >
              <span
                aria-hidden
                className="flex items-center justify-center w-9 h-7 rounded-[3px] bg-white/10 text-lg leading-none overflow-hidden shrink-0"
              >
                {c.iso ? (
                  <img
                    src={`https://flagcdn.com/w80/${c.iso}.png`}
                    srcSet={`https://flagcdn.com/w160/${c.iso}.png 2x`}
                    width={36}
                    height={28}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  c.emoji
                )}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-white truncate">
                  {isFr ? c.nameFr : c.nameEn}
                </span>
                <span className="block text-[11px] text-white/55">
                  {isFr ? 'Livraison rapide' : 'Fast delivery'}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
