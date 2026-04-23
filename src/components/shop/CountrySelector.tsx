import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Package, Truck, ShieldCheck, Headphones } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';

interface CountryRow {
  country: string;
  label_en: string;
  label_fr: string;
  flag_emoji: string;
  enabled: boolean;
  sort_order: number;
}

const FLAG_ISO: Record<string, string> = {
  usa: 'us',
  china: 'cn',
  turkey: 'tr',
};

const flagUrl = (key: string) => {
  const iso = FLAG_ISO[key] ?? key.slice(0, 2);
  return `https://flagcdn.com/w320/${iso}.png`;
};

const COUNTRY_TAGLINE: Record<string, { en: string; fr: string }> = {
  usa:    { en: 'Phones & electronics',  fr: 'Téléphones & électronique' },
  china:  { en: 'Fashion & gadgets',     fr: 'Mode & gadgets' },
  turkey: { en: 'Apparel & beauty',      fr: 'Vêtements & beauté' },
};

const FALLBACK: CountryRow[] = [
  { country: 'usa',    label_en: 'USA',    label_fr: 'États-Unis', flag_emoji: '🇺🇸', enabled: true, sort_order: 1 },
  { country: 'china',  label_en: 'China',  label_fr: 'Chine',      flag_emoji: '🇨🇳', enabled: true, sort_order: 2 },
  { country: 'turkey', label_en: 'Turkey', label_fr: 'Turquie',    flag_emoji: '🇹🇷', enabled: true, sort_order: 3 },
];

export function CountrySelector() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const isFr = language === 'fr' || language === 'ln';
  const [countries, setCountries] = useState<CountryRow[]>(FALLBACK);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await (supabase
        .from('country_shipping_rates' as any)
        .select('country, label_en, label_fr, flag_emoji, enabled, sort_order')
        .eq('enabled', true)
        .order('sort_order', { ascending: true }) as any);
      if (!cancelled && Array.isArray(data) && data.length > 0) {
        setCountries(data as CountryRow[]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleClick = async (country: string) => {
    if (country === 'usa') {
      const el = document.getElementById('shop-categories-anchor');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (country === 'china') {
      navigate(`/shop/${country}`);
      return;
    }
    const { count } = await (supabase
      .from('international_products' as any)
      .select('id', { count: 'exact', head: true })
      .eq('country', country)
      .eq('is_active', true) as any);
    if ((count ?? 0) > 0) {
      navigate(`/shop/${country}`);
    } else {
      navigate(`/shop/${country}/coming-soon`);
    }
  };

  const trustBadges = [
    { Icon: Package,     en: 'Free 30-Day Returns',  fr: 'Retours 30 jours' },
    { Icon: Truck,       en: 'Worldwide Shipping',   fr: 'Livraison mondiale' },
    { Icon: ShieldCheck, en: 'Quality Inspected',    fr: 'Qualité contrôlée' },
    { Icon: Headphones,  en: '7-Day Customer Care',  fr: 'Service 7j/7' },
  ];

  return (
    <section
      className="px-3 sm:px-6 mb-6"
      aria-label={isFr ? 'Marché mondial' : 'Global Marketplace'}
    >
      <div className="max-w-6xl mx-auto">
        {/* ===== HERO BANNER — bold blue, Gazelle-inspired ===== */}
        <div
          className="relative overflow-hidden rounded-2xl sm:rounded-3xl mb-5 sm:mb-6"
          style={{
            background:
              'linear-gradient(135deg, hsl(217 91% 38%) 0%, hsl(217 91% 50%) 50%, hsl(210 85% 45%) 100%)',
          }}
        >
          {/* Subtle wave pattern */}
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.12] pointer-events-none"
            style={{
              backgroundImage:
                'repeating-linear-gradient(135deg, rgba(255,255,255,0.6) 0 1px, transparent 1px 22px), repeating-linear-gradient(45deg, rgba(255,255,255,0.4) 0 1px, transparent 1px 22px)',
            }}
          />
          {/* Glow blobs */}
          <div aria-hidden className="absolute -top-20 -left-16 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
          <div aria-hidden className="absolute -bottom-24 -right-20 w-80 h-80 rounded-full bg-primary/30 blur-3xl" />

          <div className="relative px-6 sm:px-10 py-10 sm:py-16 md:py-20 text-center">
            <span className="inline-block text-[10px] sm:text-xs uppercase tracking-[0.25em] text-white/80 font-semibold mb-3">
              {isFr ? 'AfriShop' : 'AfriShop'}
            </span>
            <h1 className="text-3xl sm:text-5xl md:text-6xl font-bold text-white tracking-tight leading-[1.05]">
              {isFr ? 'Achetez Mondialement.' : 'Shop Globally.'}
            </h1>
            <p className="mt-2 sm:mt-3 text-xl sm:text-3xl md:text-4xl font-light text-white/95 tracking-tight leading-tight">
              {isFr ? 'Livré à votre porte.' : 'Delivered to your door.'}
            </p>
          </div>
        </div>

        {/* ===== TRUST BADGES ROW ===== */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-7 sm:mb-8">
          {trustBadges.map(({ Icon, en, fr }) => (
            <div
              key={en}
              className="flex items-center gap-2 sm:gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 sm:py-3"
            >
              <Icon className="h-4 w-4 sm:h-5 sm:w-5 text-primary flex-shrink-0" />
              <span className="text-[11px] sm:text-[13px] font-medium text-white/85 leading-tight">
                {isFr ? fr : en}
              </span>
            </div>
          ))}
        </div>

        {/* ===== COUNTRY SECTION ===== */}
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base sm:text-lg font-semibold text-white tracking-tight">
            {isFr ? 'Choisissez un pays' : 'Choose a country'}
          </h2>
          <span className="text-[11px] sm:text-xs text-white/40">
            {countries.length} {isFr ? 'destinations' : 'destinations'}
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
          {countries.map((c) => {
            const tag = COUNTRY_TAGLINE[c.country];
            return (
              <button
                key={c.country}
                onClick={() => handleClick(c.country)}
                className="group relative flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] hover:bg-primary/[0.08] hover:border-primary/40 transition-all p-3 sm:p-3.5 active:scale-[0.98] text-left overflow-hidden"
              >
                <img
                  src={flagUrl(c.country)}
                  alt=""
                  aria-hidden
                  loading="lazy"
                  className="w-10 h-7 sm:w-11 sm:h-8 rounded-md object-cover shadow-sm ring-1 ring-white/10 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm sm:text-[15px] font-semibold text-white tracking-tight leading-tight">
                    {isFr ? c.label_fr : c.label_en}
                  </h3>
                  {tag && (
                    <p className="text-[10px] sm:text-[11px] text-white/45 leading-tight mt-0.5 truncate">
                      {isFr ? tag.fr : tag.en}
                    </p>
                  )}
                </div>
                <ArrowRight className="h-4 w-4 text-white/25 group-hover:text-primary group-hover:translate-x-0.5 transition-all flex-shrink-0" />
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
