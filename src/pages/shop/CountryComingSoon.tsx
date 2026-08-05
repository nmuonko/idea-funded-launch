
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Helmet } from 'react-helmet-async';

const COUNTRY_META: Record<string, { en: string; fr: string; flag: string }> = {
  china:  { en: 'China',  fr: 'Chine',    flag: '🇨🇳' },
  turkey: { en: 'Turkey', fr: 'Turquie',  flag: '🇹🇷' },
};

// Countries that are now LIVE (backed by Shopify or other real catalogs)
// and should bypass the "coming soon" page entirely.
const LIVE_COUNTRIES = new Set<string>(['turkey']);

export default function CountryComingSoon() {
  const navigate = useNavigate();
  const { country = '' } = useParams();
  const { language } = useLanguage();
  const isFr = language === 'fr' || language === 'ln';

  const key = country.toLowerCase();

  // China is powered by Shopify — always redirect to the live shop.
  if (LIVE_COUNTRIES.has(key)) {
    return <Navigate to={`/shop/${key}`} replace />;
  }

  const meta = COUNTRY_META[key] ?? { en: country, fr: country, flag: '🌍' };
  const name = isFr ? meta.fr : meta.en;

  return (
    <div className="min-h-screen bg-[#0f1115] flex flex-col">
      <Helmet>
        <title>{`${name} — ${isFr ? 'Bientôt disponible' : 'Coming soon'} | AfriShop`}</title>
        <meta name="description" content={isFr ? `Achats depuis ${name} bientôt disponibles sur AfriShop.` : `Shopping from ${name} is coming soon to AfriShop.`} />
      </Helmet>

      <header className="px-4 pt-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/')}
          className="text-white/80 hover:text-white hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          {isFr ? 'Retour' : 'Back'}
        </Button>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="max-w-md w-full text-center">
          <div className="text-7xl md:text-8xl mb-6" aria-hidden>{meta.flag}</div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/15 text-primary text-xs font-semibold uppercase tracking-wide mb-4">
            <Sparkles className="h-3.5 w-3.5" />
            {isFr ? 'Bientôt disponible' : 'Coming soon'}
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-white mb-3">
            {isFr ? `Achats depuis ${name}` : `Shopping from ${name}`}
          </h1>
          <p className="text-white/70 text-sm md:text-base mb-8 leading-relaxed">
            {isFr
              ? `Nous travaillons à ouvrir les achats depuis ${name}. Restez à l'écoute — c'est pour très bientôt !`
              : `We're working to open shopping from ${name}. Stay tuned — it's launching very soon!`}
          </p>
          <Button
            onClick={() => navigate('/')}
            className="w-full sm:w-auto"
          >
            {isFr ? 'Continuer avec les USA' : 'Continue shopping USA'}
          </Button>
        </div>
      </main>
    </div>
  );
}
