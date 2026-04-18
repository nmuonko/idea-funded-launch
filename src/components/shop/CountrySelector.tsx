import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

  const handleClick = (country: string) => {
    if (country === 'usa') {
      // Stay on existing US storefront — just scroll past selector
      const el = document.getElementById('shop-categories-anchor');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      navigate(`/shop/${country}`);
    }
  };

  return (
    <section className="px-4 mb-6" aria-label={isFr ? 'Choisir un pays' : 'Choose a country'}>
      <div className="w-full">
        <h2 className="text-base md:text-lg font-semibold text-foreground mb-3">
          {isFr ? 'Acheter par pays' : 'Shop by country'}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full">
          {countries.map((c) => (
            <button
              key={c.country}
              onClick={() => handleClick(c.country)}
              className="group relative flex flex-col items-center justify-center gap-2 rounded-2xl border border-border/40 bg-card hover:bg-card/80 hover:border-primary/50 transition-all p-5 md:p-6 active:scale-[0.98] w-full"
            >
              <span className="text-4xl md:text-5xl leading-none" aria-hidden>{c.flag_emoji}</span>
              <span className="text-sm md:text-base font-semibold text-foreground">
                {isFr ? c.label_fr : c.label_en}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
