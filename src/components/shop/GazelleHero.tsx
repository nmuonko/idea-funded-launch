import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import heroIphone from '@/assets/hero-iphone-left.png';
import heroPixel from '@/assets/hero-pixel-right.png';

/**
 * Gazelle-style hero: bold blue banner with real phones flanking the message.
 * Left: iPhone. Right: Google Pixel.
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
              'linear-gradient(135deg, hsl(232 88% 38%) 0%, hsl(232 92% 48%) 55%, hsl(225 90% 42%) 100%)',
          }}
        >
          {/* Subtle zebra/stripe texture like the reference */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.18] pointer-events-none mix-blend-overlay"
            style={{
              backgroundImage:
                'repeating-linear-gradient(115deg, rgba(255,255,255,0.55) 0 2px, transparent 2px 26px)',
            }}
          />
          <div aria-hidden className="absolute -top-24 -left-20 w-80 h-80 rounded-full bg-white/10 blur-3xl" />
          <div aria-hidden className="absolute -bottom-24 -right-20 w-96 h-96 rounded-full bg-cyan-300/15 blur-3xl" />

          {/* Left phone (iPhone) — angled into frame */}
          <img
            src={heroIphone}
            alt=""
            aria-hidden
            draggable={false}
            className="hidden sm:block absolute left-0 top-1/2 -translate-y-1/2 -translate-x-[18%] sm:-translate-x-[14%] md:-translate-x-[10%] w-[210px] sm:w-[260px] md:w-[320px] lg:w-[360px] h-auto object-contain select-none -rotate-[18deg] drop-shadow-[0_24px_30px_rgba(0,0,0,0.45)] pointer-events-none z-10"
          />

          {/* Right phone (Google Pixel) — angled into frame */}
          <img
            src={heroPixel}
            alt=""
            aria-hidden
            draggable={false}
            className="hidden sm:block absolute right-0 top-1/2 -translate-y-1/2 translate-x-[18%] sm:translate-x-[14%] md:translate-x-[10%] w-[210px] sm:w-[260px] md:w-[320px] lg:w-[360px] h-auto object-contain select-none rotate-[16deg] drop-shadow-[0_24px_30px_rgba(0,0,0,0.45)] pointer-events-none z-10"
          />

          {/* Centered text content */}
          <div className="relative z-20 text-center px-6 sm:px-10 md:px-14 py-12 sm:py-16 md:py-20">
            <span className="inline-block text-[10px] sm:text-xs uppercase tracking-[0.3em] text-white/85 font-semibold mb-3">
              AfriShop
            </span>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-white tracking-tight leading-[1.02]">
              {isFr ? 'iPhone & Pixel' : 'iPhone & Pixel'}
            </h1>
            <p className="mt-3 text-base sm:text-lg md:text-2xl text-white/90 font-light max-w-xl mx-auto leading-relaxed">
              {isFr ? 'Qualité et accessibilité.' : 'Quality meets Affordability.'}
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
              <a
                href="#phones-grid"
                className="inline-flex items-center justify-center rounded-full bg-white text-blue-700 hover:bg-white/95 font-semibold text-sm px-5 py-2.5 shadow-sm transition"
              >
                {isFr ? 'Voir les téléphones' : 'Shop phones'}
              </a>
              <Link
                to="/category/phones"
                className="inline-flex items-center justify-center rounded-full border border-white/40 text-white hover:bg-white/10 font-medium text-sm px-5 py-2.5 transition"
              >
                {isFr ? 'Tout parcourir' : 'Browse all'}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
