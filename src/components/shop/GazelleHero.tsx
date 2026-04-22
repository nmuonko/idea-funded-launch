import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import heroIphoneLeft from '@/assets/hero-iphone-left.png';
import heroPixelRight from '@/assets/hero-pixel-right.png';
import heroPixel10Left from '@/assets/hero-pixel10-left.png';
import heroPixel10Right from '@/assets/hero-pixel10-right.png';

/**
 * Gazelle-style hero: short, wide dark-blue banner.
 * Auto-rotates between iPhone and Google Pixel 10 every 5 seconds.
 */
export function GazelleHero() {
  const { language } = useLanguage();
  const isFr = language === 'fr' || language === 'ln';

  const slides = [
    {
      key: 'iphone',
      leftImg: heroIphoneLeft,
      rightImg: heroPixelRight,
      title: isFr ? 'iPhone — Qualité et accessibilité.' : 'iPhone — Quality meets affordability.',
      subtitle: isFr ? 'Reconditionnés, testés et fiables.' : 'Refurbished, tested and reliable.',
      cta: isFr ? 'Voir les iPhones' : 'Shop iPhones',
      ctaHref: '#phones-grid',
    },
    {
      key: 'pixel10',
      leftImg: heroPixel10Left,
      rightImg: heroPixel10Right,
      title: isFr ? 'Google Pixel 10 — Nouvelle génération.' : 'Google Pixel 10 — Next-gen Android.',
      subtitle: isFr ? 'Photo IA, design premium, prix juste.' : 'AI photography, premium design, fair price.',
      cta: isFr ? 'Voir les Pixel' : 'Shop Pixel',
      ctaHref: '#phones-grid',
    },
  ];

  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % slides.length), 5000);
    return () => clearInterval(t);
  }, [slides.length]);

  const slide = slides[idx];

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

          {/* Compact banner */}
          <div className="relative flex items-center justify-center min-h-[150px] sm:min-h-[200px] md:min-h-[230px] px-4 sm:px-10 md:px-16 py-5 sm:py-6">
            {/* Left phone */}
            <img
              key={`l-${slide.key}`}
              src={slide.leftImg}
              alt=""
              aria-hidden
              draggable={false}
              className="hidden sm:block absolute left-2 md:left-6 lg:left-12 top-1/2 -translate-y-1/2 -rotate-[14deg] w-[140px] md:w-[180px] lg:w-[210px] h-auto object-contain drop-shadow-[0_18px_22px_rgba(0,0,0,0.45)] select-none animate-in fade-in zoom-in-95 duration-700"
            />
            {/* Right phone */}
            <img
              key={`r-${slide.key}`}
              src={slide.rightImg}
              alt=""
              aria-hidden
              draggable={false}
              className="hidden sm:block absolute right-2 md:right-6 lg:right-12 top-1/2 -translate-y-1/2 rotate-[14deg] w-[140px] md:w-[180px] lg:w-[210px] h-auto object-contain drop-shadow-[0_18px_22px_rgba(0,0,0,0.45)] select-none animate-in fade-in zoom-in-95 duration-700"
            />

            {/* Centered text */}
            <div key={`t-${slide.key}`} className="relative text-center max-w-xl mx-auto animate-in fade-in slide-in-from-bottom-2 duration-500">
              <span className="inline-block text-[10px] sm:text-[11px] uppercase tracking-[0.28em] text-white/85 font-semibold mb-1.5">
                AfriShop
              </span>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight leading-[1.05]">
                {slide.title}
              </h1>
              <p className="mt-1.5 text-xs sm:text-sm md:text-base text-white/85 font-normal leading-snug">
                {slide.subtitle}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <a
                  href={slide.ctaHref}
                  className="inline-flex items-center justify-center rounded-full bg-white text-blue-700 hover:bg-white/95 font-semibold text-xs sm:text-sm px-4 py-1.5 shadow-sm transition"
                >
                  {slide.cta}
                </a>
                <Link
                  to="/category/phones"
                  className="inline-flex items-center justify-center rounded-full border border-white/30 text-white hover:bg-white/10 font-medium text-xs sm:text-sm px-4 py-1.5 transition"
                >
                  {isFr ? 'Tout parcourir' : 'Browse all'}
                </Link>
              </div>
            </div>

            {/* Slide indicators */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
              {slides.map((s, i) => (
                <button
                  key={s.key}
                  onClick={() => setIdx(i)}
                  aria-label={`Slide ${i + 1}`}
                  className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-5 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70'}`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
