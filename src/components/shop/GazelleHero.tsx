import { useLanguage } from '@/contexts/LanguageContext';
import heroIphone from '@/assets/hero-phone-iphone.png';

/**
 * Compact AfriShop hero — cream background, left copy, right phone showcase.
 * Matches the catalog-first reference design.
 */
export function GazelleHero() {
  const { language } = useLanguage();
  const isFr = language === 'fr' || language === 'ln';

  return (
    <section className="px-3 sm:px-4 pt-3" aria-label={isFr ? 'Bienvenue' : 'Welcome'}>
      <div className="max-w-6xl mx-auto">
        <div
          className="relative overflow-hidden rounded-2xl"
          style={{
            background:
              'linear-gradient(120deg, #f6efe2 0%, #efe5d2 60%, #e8dcc4 100%)',
          }}
        >
          <div className="relative grid grid-cols-1 md:grid-cols-2 items-center gap-4 px-5 sm:px-8 md:px-12 py-8 sm:py-10 md:py-12 min-h-[220px] md:min-h-[260px]">
            {/* Left: copy */}
            <div className="relative z-10 max-w-xl">
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-neutral-900 tracking-tight leading-[1.15]">
                {isFr
                  ? 'Achetez des smartphones des USA pour vos proches au Congo'
                  : 'Buy smartphones from the USA for your loved ones in Congo'}
              </h1>
              <p className="mt-3 text-sm sm:text-base text-neutral-700 leading-relaxed">
                {isFr
                  ? 'Prix tout inclus (produits, taxes, livraison). Livraison rapide au Congo.'
                  : 'All-inclusive pricing (product, taxes, shipping). Fast delivery to Congo.'}
                <br />
                {isFr ? 'Paiement 100% sécurisé.' : '100% secure payment.'}
              </p>
            </div>

            {/* Right: phone image */}
            <div className="hidden md:block relative h-full min-h-[220px]">
              <img
                src={heroIphone}
                alt=""
                aria-hidden
                draggable={false}
                className="absolute right-[-10%] top-1/2 -translate-y-1/2 h-[140%] w-auto object-contain"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
