import { Link } from 'react-router-dom';
import { Truck, ShieldCheck, Headphones, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Gazelle-style hero: bold blue banner with iPhone messaging,
 * followed by a clean trust bar. Visual only — no logic changes.
 */
export function GazelleHero() {
  const { language } = useLanguage();
  const isFr = language === 'fr' || language === 'ln';

  const trust = [
    { Icon: Truck,       en: 'Fast shipping to DRC',   fr: 'Livraison rapide vers la RDC' },
    { Icon: ShieldCheck, en: 'Verified & tested',      fr: 'Vérifié & testé' },
    { Icon: Headphones,  en: 'Customer support',       fr: 'Support client' },
    { Icon: RotateCcw,   en: 'Return guarantee',       fr: 'Garantie retour' },
  ];

  return (
    <section className="px-3 sm:px-6 mb-6" aria-label={isFr ? 'Bienvenue' : 'Welcome'}>
      <div className="max-w-6xl mx-auto">
        {/* ===== HERO ===== */}
        <div
          className="relative overflow-hidden rounded-2xl sm:rounded-3xl"
          style={{
            background:
              'linear-gradient(135deg, hsl(217 91% 36%) 0%, hsl(217 91% 48%) 55%, hsl(210 90% 42%) 100%)',
          }}
        >
          {/* Soft pattern */}
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
            {/* Copy */}
            <div className="text-center md:text-left">
              <span className="inline-block text-[10px] sm:text-xs uppercase tracking-[0.25em] text-white/85 font-semibold mb-3">
                {isFr ? 'AfriShop' : 'AfriShop'}
              </span>
              <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold text-white tracking-tight leading-[1.05]">
                {isFr ? 'iPhone — Qualité et accessibilité.' : 'iPhone — Quality meets affordability.'}
              </h1>
              <p className="mt-3 text-sm sm:text-base md:text-lg text-white/90 max-w-xl mx-auto md:mx-0">
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

            {/* Phone visuals (CSS only — no external assets) */}
            <div aria-hidden className="hidden md:flex items-center justify-end gap-4 pr-2">
              <PhoneMock tilt="-rotate-6" />
              <PhoneMock tilt="rotate-6" />
            </div>
          </div>
        </div>

        {/* ===== TRUST BAR ===== */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
          {trust.map(({ Icon, en, fr }) => (
            <div
              key={en}
              className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15">
                <Icon className="h-4 w-4 text-primary" />
              </span>
              <span className="text-[11px] sm:text-[13px] font-medium text-white/85 leading-tight">
                {isFr ? fr : en}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function PhoneMock({ tilt }: { tilt: string }) {
  return (
    <div
      className={`relative w-[120px] h-[230px] lg:w-[140px] lg:h-[270px] rounded-[28px] bg-gradient-to-b from-slate-800 to-slate-950 shadow-2xl ring-1 ring-white/10 ${tilt}`}
    >
      <div className="absolute inset-1.5 rounded-[22px] bg-gradient-to-br from-blue-500/40 via-cyan-300/20 to-blue-700/40" />
      <div className="absolute top-2 left-1/2 -translate-x-1/2 h-4 w-16 rounded-full bg-black/60" />
    </div>
  );
}
