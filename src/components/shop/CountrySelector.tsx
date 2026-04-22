import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
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
  usa:    { en: 'Phones & electronics',  fr: 'Téléphones & électronique' },
  china:  { en: 'Fashion & gadgets',     fr: 'Mode & gadgets' },
  dubai:  { en: 'Luxury & premium',      fr: 'Luxe & premium' },
  turkey: { en: 'Apparel & beauty',      fr: 'Vêtements & beauté' },
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
      className="px-4 sm:px-6 mb-6"
      aria-label={isFr ? 'Choisir un pays' : 'Choose a country'}
    >
      <div className="max-w-6xl mx-auto">
        {/* Compact hero — single tight line, no wrap weirdness */}
        <div className="text-center pt-4 pb-5 sm:pb-6">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 mb-3">
            <Sparkles className="h-3 w-3 text-primary" />
            <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.15em] text-primary font-semibold">
              {isFr ? 'Marché Mondial' : 'Global Marketplace'}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white tracking-tight leading-[1.15] max-w-2xl mx-auto">
            {isFr ? (
              <>Achetez à l'étranger,<br className="sm:hidden" />{' '}
                <span className="text-primary">livré chez vous</span>
              </>
            ) : (
              <>Shop globally,<br className="sm:hidden" />{' '}
                <span className="text-primary">delivered locally</span>
              </>
            )}
          </h1>
        </div>

        {/* Country label */}
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm sm:text-base font-semibold text-white tracking-tight">
            {isFr ? 'Choisissez un pays' : 'Choose a country'}
          </h2>
          <span className="text-[11px] text-white/40">
            {countries.length} {isFr ? 'destinations' : 'destinations'}
          </span>
        </div>

        {/* Country tiles — denser, more product-feeling */}
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
