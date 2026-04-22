import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
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
  dubai: 'ae',
  turkey: 'tr',
};

const flagUrl = (key: string) => {
  const iso = FLAG_ISO[key] ?? key.slice(0, 2);
  return `https://flagcdn.com/w320/${iso}.png`;
};

const COUNTRY_TAGLINE: Record<string, { en: string; fr: string }> = {
  usa:    { en: 'Phones, electronics & more', fr: 'Téléphones, électronique & plus' },
  china:  { en: 'Fashion, gadgets, value',    fr: 'Mode, gadgets, bonnes affaires' },
  dubai:  { en: 'Luxury & premium goods',     fr: 'Luxe & produits premium' },
  turkey: { en: 'Apparel, leather, beauty',   fr: 'Vêtements, cuir, beauté' },
};

const FALLBACK: CountryRow[] = [
  { country: 'usa',    label_en: 'USA',    label_fr: 'États-Unis', flag_emoji: '🇺🇸', enabled: true, sort_order: 1 },
  { country: 'china',  label_en: 'China',  label_fr: 'Chine',      flag_emoji: '🇨🇳', enabled: true, sort_order: 2 },
  { country: 'dubai',  label_en: 'Dubai',  label_fr: 'Dubaï',      flag_emoji: '🇦🇪', enabled: true, sort_order: 3 },
  { country: 'turkey', label_en: 'Turkey', label_fr: 'Turquie',    flag_emoji: '🇹🇷', enabled: true, sort_order: 4 },
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

  return (
    <section
      className="px-4 sm:px-6 mb-8 mt-2"
      aria-label={isFr ? 'Choisir un pays' : 'Choose a country'}
    >
      <div className="max-w-6xl mx-auto">
        {/* Hero header — clean, premium, Gazelle-inspired */}
        <div className="text-center mb-6 sm:mb-8">
          <p className="text-[11px] sm:text-xs uppercase tracking-[0.2em] text-primary/80 font-semibold mb-2">
            {isFr ? 'Boutique mondiale' : 'Global Marketplace'}
          </p>
          <h1 className="text-2xl sm:text-4xl md:text-5xl font-bold text-white tracking-tight leading-tight">
            {isFr ? (
              <>Achetez partout dans le monde,<br className="hidden sm:block" /> <span className="text-primary">livré chez vous</span>.</>
            ) : (
              <>Shop the world,<br className="hidden sm:block" /> <span className="text-primary">delivered to your door</span>.</>
            )}
          </h1>
          <p className="text-sm sm:text-base text-white/60 mt-3 max-w-xl mx-auto">
            {isFr
              ? 'Choisissez un pays pour découvrir des produits authentiques.'
              : 'Pick a country to discover authentic products.'}
          </p>
        </div>

        {/* Country tiles — clean card grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {countries.map((c) => {
            const tag = COUNTRY_TAGLINE[c.country];
            return (
              <button
                key={c.country}
                onClick={() => handleClick(c.country)}
                className="group relative flex flex-col items-start gap-3 rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-white/[0.01] hover:from-primary/10 hover:to-white/[0.02] hover:border-primary/40 transition-all p-4 sm:p-5 active:scale-[0.98] text-left overflow-hidden"
              >
                {/* Subtle blue glow on hover */}
                <div className="absolute inset-0 bg-gradient-to-br from-primary/0 via-primary/0 to-primary/0 group-hover:from-primary/5 group-hover:to-transparent transition-all pointer-events-none" />

                <div className="relative flex items-center justify-between w-full">
                  <img
                    src={flagUrl(c.country)}
                    alt=""
                    aria-hidden
                    loading="lazy"
                    className="w-12 h-8 sm:w-14 sm:h-10 rounded-md object-cover shadow-md ring-1 ring-white/10"
                  />
                  <ArrowRight className="h-4 w-4 text-white/30 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                </div>

                <div className="relative w-full">
                  <h3 className="text-base sm:text-lg font-semibold text-white tracking-tight">
                    {isFr ? c.label_fr : c.label_en}
                  </h3>
                  {tag && (
                    <p className="text-[11px] sm:text-xs text-white/50 mt-0.5 leading-snug line-clamp-1">
                      {isFr ? tag.fr : tag.en}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
