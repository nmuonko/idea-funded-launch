import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import heroIphone from '@/assets/hero-phone-iphone.png';
import heroPixel from '@/assets/hero-phone-pixel.png';
import heroSamsung from '@/assets/hero-phone-samsung.png';

type Slide = {
  src: string;
  brand: string;
  titleEn: string;
  titleFr: string;
  subEn: string;
  subFr: string;
};

const SLIDES: Slide[] = [
  {
    src: heroIphone,
    brand: 'iPhone',
    titleEn: 'Quality meets Affordability.',
    titleFr: 'Qualité et accessibilité.',
    subEn: 'Refurbished, tested and reliable.',
    subFr: 'Reconditionnés, testés et fiables.',
  },
  {
    src: heroPixel,
    brand: 'Google Pixel 10',
    titleEn: 'Pure Android. Pure power.',
    titleFr: 'Android pur. Puissance pure.',
    subEn: 'The smartest camera in your pocket.',
    subFr: "L'appareil photo le plus intelligent.",
  },
  {
    src: heroSamsung,
    brand: 'Samsung Galaxy',
    titleEn: 'Brilliant. Bold. Yours.',
    titleFr: 'Brillant. Audacieux. À vous.',
    subEn: 'Flagship features, flagship value.',
    subFr: 'Performances haut de gamme, prix juste.',
  },
];

/**
 * Gazelle-style hero: short, wide blue banner with rotating phone showcases.
 * Each slide shows a phone-pair image split across left/right and crossfades every ~4.5s.
 */
export function GazelleHero() {
  const { language } = useLanguage();
  const isFr = language === 'fr' || language === 'ln';
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % SLIDES.length);
    }, 15000);
    return () => clearInterval(id);
  }, []);

  const slide = SLIDES[index];

  return (
    <section className="px-2 sm:px-4 mb-4" aria-label={isFr ? 'Bienvenue' : 'Welcome'}>
      <div className="max-w-7xl mx-auto">
        <div
          className="relative overflow-hidden rounded-md"
          style={{
            background:
              'linear-gradient(135deg, hsl(230 70% 30%) 0%, hsl(230 75% 38%) 50%, hsl(230 70% 32%) 100%)',
          }}
        >
          {/* subtle wavy stripe texture */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.18] pointer-events-none"
            style={{
              backgroundImage:
                'repeating-linear-gradient(115deg, rgba(255,255,255,0.55) 0 2px, transparent 2px 26px)',
              mixBlendMode: 'overlay',
            }}
          />
          <div aria-hidden className="absolute -top-16 -left-16 w-64 h-64 rounded-full bg-white/10 blur-3xl" />
          <div aria-hidden className="absolute -bottom-16 -right-16 w-72 h-72 rounded-full bg-cyan-300/10 blur-3xl" />

          <div className="relative flex items-center justify-center min-h-[120px] sm:min-h-[150px] md:min-h-[170px] px-4 sm:px-10 md:px-16 py-3 sm:py-4">
            {/* Left half of phone-pair image (crossfading) */}
            <div className="hidden sm:block absolute left-0 top-0 bottom-0 w-[34%] md:w-[30%] lg:w-[28%] pointer-events-none">
              {SLIDES.map((s, i) => (
                <img
                  key={`L-${s.brand}`}
                  src={s.src}
                  alt=""
                  aria-hidden
                  draggable={false}
                  className={`absolute inset-0 w-full h-full object-cover object-right transition-opacity duration-700 ease-out ${
                    i === index ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={{ objectPosition: '70% center' }}
                />
              ))}
            </div>

            {/* Right half of phone-pair image (crossfading) */}
            <div className="hidden sm:block absolute right-0 top-0 bottom-0 w-[34%] md:w-[30%] lg:w-[28%] pointer-events-none">
              {SLIDES.map((s, i) => (
                <img
                  key={`R-${s.brand}`}
                  src={s.src}
                  alt=""
                  aria-hidden
                  draggable={false}
                  className={`absolute inset-0 w-full h-full object-cover object-left transition-opacity duration-700 ease-out ${
                    i === index ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={{ objectPosition: '30% center' }}
                />
              ))}
            </div>

            {/* Centered text */}
            <div className="relative text-center max-w-xl mx-auto z-10">
              <span className="inline-block text-[9px] sm:text-[10px] uppercase tracking-[0.28em] text-white/85 font-semibold mb-1">
                AfriShop
              </span>
              <h1 className="text-lg sm:text-2xl md:text-3xl font-extrabold text-white tracking-tight leading-[1.05] transition-opacity duration-500">
                {slide.brand}
              </h1>
              <p className="mt-1 text-[11px] sm:text-xs md:text-sm text-white/90 font-medium leading-snug transition-opacity duration-500">
                {isFr ? slide.titleFr : slide.titleEn}
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                <a
                  href="#phones-grid"
                  className="inline-flex items-center justify-center rounded-full bg-white text-blue-700 hover:bg-white/95 font-semibold text-xs sm:text-sm px-4 py-1.5 shadow-sm transition"
                >
                  {isFr ? 'Voir les téléphones' : 'Shop phones'}
                </a>
                <Link
                  to="/category/phones"
                  className="inline-flex items-center justify-center rounded-full border border-white/30 text-white hover:bg-white/10 font-medium text-xs sm:text-sm px-4 py-1.5 transition"
                >
                  {isFr ? 'Tout parcourir' : 'Browse all'}
                </Link>
              </div>

              {/* Slide indicator dots */}
              <div className="mt-2.5 flex items-center justify-center gap-1.5">
                {SLIDES.map((s, i) => (
                  <button
                    key={s.brand}
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-label={`Show ${s.brand}`}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i === index ? 'w-5 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/60'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
