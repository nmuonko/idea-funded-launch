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
    <section className="px-4 mb-4" aria-label={isFr ? 'Choisir un pays' : 'Choose a country'}>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-foreground/90">
            {isFr ? 'Acheter par pays' : 'Shop by country'}
          </h2>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {countries.map((c) => (
            <button
              key={c.country}
              onClick={() => handleClick(c.country)}
              className="group flex flex-row md:flex-col items-center justify-center gap-2 rounded-xl border border-border/40 bg-card hover:bg-card/80 hover:border-primary/50 transition-all px-3 py-2.5 md:py-3 active:scale-[0.98]"
            >
              <span className="text-xl md:text-2xl leading-none" aria-hidden>{c.flag_emoji}</span>
              <span className="text-xs md:text-sm font-medium text-foreground truncate">
                {isFr ? c.label_fr : c.label_en}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
