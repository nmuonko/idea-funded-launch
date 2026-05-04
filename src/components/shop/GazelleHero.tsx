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
 * Each slide stays visible for 45s so the homepage feels calmer and less ad-like.
 */
export function GazelleHero() {
  const { language } = useLanguage();
  const isFr = language === 'fr' || language === 'ln';
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % SLIDES.length);
    }, 45000);
    return () => clearInterval(id);
  }, []);

  const slide = SLIDES[index];

  return (
    <section aria-label={isFr ? 'Bienvenue' : 'Welcome'}>
      <div className="w-full">
        <div
          className="relative overflow-hidden shadow-sm"
          style={{
            background:
              'radial-gradient(circle at 20% 20%, hsl(220 90% 55%) 0%, transparent 55%), radial-gradient(circle at 85% 80%, hsl(260 75% 45%) 0%, transparent 50%), linear-gradient(135deg, hsl(225 75% 22%) 0%, hsl(230 80% 32%) 50%, hsl(240 70% 25%) 100%)',
          }}
        >
          {/* soft diagonal sheen */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.10] pointer-events-none"
            style={{
              backgroundImage:
                'repeating-linear-gradient(120deg, rgba(255,255,255,0.6) 0 1px, transparent 1px 32px)',
              mixBlendMode: 'overlay',
            }}
          />
          <div aria-hidden className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-white/15 blur-3xl" />
          <div aria-hidden className="absolute -bottom-24 -right-24 w-80 h-80 rounded-full bg-cyan-300/15 blur-3xl" />

          <div className="relative flex items-center justify-center min-h-[180px] sm:min-h-[220px] md:min-h-[260px] px-4 sm:px-10 md:px-16 py-6 sm:py-8">
            {/* Left half of phone-pair image (crossfading) */}
            <div className="hidden sm:block absolute left-0 top-0 bottom-0 w-[30%] md:w-[28%] lg:w-[26%] pointer-events-none overflow-hidden">
              {SLIDES.map((s, i) => (
                <img
                  key={`L-${s.brand}`}
                  src={s.src}
                  alt=""
                  aria-hidden
                  draggable={false}
                  className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-700 ease-out ${
                    i === index ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={{ objectPosition: 'right center', transform: 'scale(1.05)' }}
                />
              ))}
            </div>

            {/* Right half of phone-pair image (crossfading) */}
            <div className="hidden sm:block absolute right-0 top-0 bottom-0 w-[30%] md:w-[28%] lg:w-[26%] pointer-events-none overflow-hidden">
              {SLIDES.map((s, i) => (
                <img
                  key={`R-${s.brand}`}
                  src={s.src}
                  alt=""
                  aria-hidden
                  draggable={false}
                  className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-700 ease-out ${
                    i === index ? 'opacity-100' : 'opacity-0'
                  }`}
                  style={{ objectPosition: 'left center', transform: 'scale(1.05)' }}
                />
              ))}
            </div>

            {/* Centered text */}
            <div className="relative text-center max-w-2xl mx-auto z-10">
              <h1 className="text-2xl sm:text-4xl md:text-5xl font-extrabold text-white tracking-tight leading-[1.05] transition-opacity duration-500">
                <span className="block sm:inline">{slide.brand} —</span>{' '}
                <span className="block sm:inline">{isFr ? slide.titleFr : slide.titleEn}</span>
              </h1>
              <p className="mt-3 text-sm sm:text-base text-white/85 font-medium leading-snug transition-opacity duration-500">
                {isFr ? slide.subFr : slide.subEn}
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <a
                  href="#phones-grid"
                  className="inline-flex items-center justify-center rounded-full bg-white text-blue-700 hover:bg-white/95 font-semibold text-sm sm:text-base px-6 py-2.5 shadow-sm transition"
                >
                  {isFr ? 'Voir les téléphones' : 'Shop phones'}
                </a>
                <Link
                  to="/category/phones"
                  className="inline-flex items-center justify-center rounded-full border border-white/35 text-white hover:bg-white/10 font-medium text-sm sm:text-base px-6 py-2.5 transition"
                >
                  {isFr ? 'Tout parcourir' : 'Browse all'}
                </Link>
              </div>

              {/* Slide indicator dots */}
              <div className="mt-4 flex items-center justify-center gap-1.5">
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
