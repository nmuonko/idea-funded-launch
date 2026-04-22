import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import heroIphones from '@/assets/hero-iphones.png';

/**
 * Gazelle-style hero: bold blue banner with iPhone messaging.
 * Visual only — no logic changes.
 */
export function GazelleHero() {
  const { language } = useLanguage();
  const isFr = language === 'fr' || language === 'ln';

  return (
    <section className="px-3 sm:px-6 mb-6" aria-label={isFr ? 'Bienvenue' : 'Welcome'}>
      <div className="max-w-6xl mx-auto">
        <div
          className="relative overflow-hidden rounded-2xl sm:rounded-3xl"
          style={{
            background:
              'linear-gradient(135deg, hsl(217 91% 36%) 0%, hsl(217 91% 48%) 55%, hsl(210 90% 42%) 100%)',
          }}
        >
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.10] pointer-events-none"
            style={{
              backgroundImage:
                'repeating-linear-gradient(135deg, rgba(255,255,255,0.6) 0 1px, transparent 1px 24px)',
            }}
          />
          <div aria-hidden className="absolute -top-24 -left-20 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
          <div aria-hidden className="absolute -bottom-24 -right-20 w-96 h-96 rounded-full bg-cyan-300/20 blur-3xl" />

          <div className="relative grid grid-cols-1 md:grid-cols-[1fr_auto] items-center gap-6 px-6 sm:px-10 py-10 sm:py-14">
            <div className="text-center md:text-left">
              <span className="inline-block text-[10px] sm:text-xs uppercase tracking-[0.25em] text-white/85 font-semibold mb-3">
                AfriShop
              </span>
              <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white tracking-tight leading-[1.02]">
                {isFr ? 'iPhone — Qualité et accessibilité.' : 'iPhone — Quality meets affordability.'}
              </h1>
              <p className="mt-4 text-base sm:text-lg md:text-xl text-white/90 font-normal max-w-xl mx-auto md:mx-0 leading-relaxed">
                {isFr
                  ? 'Reconditionnés, testés et fiables. Livrés directement chez vous.'
                  : 'Refurbished, tested and reliable. Delivered straight to your door.'}
              </p>

              <div className="mt-6 flex flex-wrap items-center justify-center md:justify-start gap-2.5">
                <a
                  href="#phones-grid"
                  className="inline-flex items-center justify-center rounded-full bg-white text-blue-700 hover:bg-white/95 font-semibold text-sm px-5 py-2.5 shadow-sm transition"
                >
                  {isFr ? 'Voir les iPhones' : 'Shop iPhones'}
                </a>
                <Link
                  to="/category/phones"
                  className="inline-flex items-center justify-center rounded-full border border-white/30 text-white hover:bg-white/10 font-medium text-sm px-5 py-2.5 transition"
                >
                  {isFr ? 'Tout parcourir' : 'Browse all'}
                </Link>
              </div>
            </div>

            <div aria-hidden className="hidden md:flex items-center justify-end pr-2">
              <img
                src={heroIphones}
                alt="iPhones"
                width={520}
                height={520}
                className="w-[360px] lg:w-[460px] h-auto object-contain drop-shadow-2xl select-none"
                draggable={false}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
