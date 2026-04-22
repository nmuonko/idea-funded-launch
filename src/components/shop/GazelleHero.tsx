import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import heroIphoneLeft from '@/assets/hero-iphone-left.png';
import heroPixelRight from '@/assets/hero-pixel-right.png';

/**
 * Gazelle-style hero: short, wide dark-blue banner.
 * Compact desktop height (~230px), minimal radius, edge-to-edge feel.
 */
export function GazelleHero() {
  const { language } = useLanguage();
  const isFr = language === 'fr' || language === 'ln';

  return (
    <section className="px-2 sm:px-4 mb-4" aria-label={isFr ? 'Bienvenue' : 'Welcome'}>
      <div className="max-w-7xl mx-auto">
        <div
          className="relative overflow-hidden rounded-md"
          style={{
            background:
              'linear-gradient(135deg, hsl(222 60% 12%) 0%, hsl(222 55% 18%) 45%, hsl(220 50% 24%) 100%)',
          }}
        >
          {/* subtle stripe texture */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.10] pointer-events-none"
            style={{
              backgroundImage:
                'repeating-linear-gradient(115deg, rgba(255,255,255,0.55) 0 1px, transparent 1px 22px)',
              mixBlendMode: 'overlay',
            }}
          />
          <div aria-hidden className="absolute -top-16 -left-16 w-64 h-64 rounded-full bg-white/10 blur-3xl" />
          <div aria-hidden className="absolute -bottom-16 -right-16 w-72 h-72 rounded-full bg-cyan-300/15 blur-3xl" />

          {/* Compact banner: ~150px mobile, ~230px desktop */}
          <div className="relative flex items-center justify-center min-h-[150px] sm:min-h-[200px] md:min-h-[230px] px-4 sm:px-10 md:px-16 py-5 sm:py-6">
            {/* Left phone */}
            <img
              src={heroIphoneLeft}
              alt=""
              aria-hidden
              draggable={false}
              className="hidden sm:block absolute left-2 md:left-6 lg:left-12 top-1/2 -translate-y-1/2 -rotate-[14deg] w-[140px] md:w-[180px] lg:w-[210px] h-auto object-contain drop-shadow-[0_18px_22px_rgba(0,0,0,0.45)] select-none"
            />
            {/* Right phone */}
            <img
              src={heroPixelRight}
              alt=""
              aria-hidden
              draggable={false}
              className="hidden sm:block absolute right-2 md:right-6 lg:right-12 top-1/2 -translate-y-1/2 rotate-[14deg] w-[140px] md:w-[180px] lg:w-[210px] h-auto object-contain drop-shadow-[0_18px_22px_rgba(0,0,0,0.45)] select-none"
            />

            {/* Centered text */}
            <div className="relative text-center max-w-xl mx-auto">
              <span className="inline-block text-[10px] sm:text-[11px] uppercase tracking-[0.28em] text-white/85 font-semibold mb-1.5">
                AfriShop
              </span>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight leading-[1.05]">
                {isFr ? 'iPhone — Qualité et accessibilité.' : 'iPhone — Quality meets affordability.'}
              </h1>
              <p className="mt-1.5 text-xs sm:text-sm md:text-base text-white/85 font-normal leading-snug">
                {isFr
                  ? 'Reconditionnés, testés et fiables.'
                  : 'Refurbished, tested and reliable.'}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <a
                  href="#phones-grid"
                  className="inline-flex items-center justify-center rounded-full bg-white text-blue-700 hover:bg-white/95 font-semibold text-xs sm:text-sm px-4 py-1.5 shadow-sm transition"
                >
                  {isFr ? 'Voir les iPhones' : 'Shop iPhones'}
                </a>
                <Link
                  to="/category/phones"
                  className="inline-flex items-center justify-center rounded-full border border-white/30 text-white hover:bg-white/10 font-medium text-xs sm:text-sm px-4 py-1.5 transition"
                >
                  {isFr ? 'Tout parcourir' : 'Browse all'}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
