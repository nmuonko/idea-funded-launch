import { useLanguage } from '@/contexts/LanguageContext';
import heroTrio from '@/assets/hero-phones-trio.jpg';

/**
 * Compact AfriShop hero — cream marble background, left copy, right phone trio.
 * Matches the AfriShop reference design.
 */
export function GazelleHero() {
  const { language } = useLanguage();
  const isFr = language === 'fr' || language === 'ln';

  return (
    <section className="px-3 sm:px-4 pt-3" aria-label={isFr ? 'Bienvenue' : 'Welcome'}>
      <div className="max-w-[1440px] mx-auto">
        <div
          className="relative overflow-hidden rounded-2xl border border-[#EAE2D6]"
          style={{
            background:
              'linear-gradient(120deg, #f6efe2 0%, #efe5d2 55%, #e8dcc4 100%)',
          }}
        >
          <div className="relative grid grid-cols-1 md:grid-cols-2 items-center gap-4 px-5 sm:px-8 md:px-12 py-8 sm:py-10 md:py-12 min-h-[260px] md:min-h-[320px]">
            {/* Left: copy */}
            <div className="relative z-10 max-w-xl">
              <h1 className="text-2xl sm:text-3xl md:text-[40px] font-extrabold text-neutral-900 tracking-tight leading-[1.1]">
                {isFr
                  ? 'Achetez des smartphones des USA pour vos proches au Congo'
                  : 'Buy smartphones from the USA for your loved ones in Congo'}
              </h1>
              <p className="mt-4 text-sm sm:text-base text-neutral-700 leading-relaxed">
                {isFr
                  ? 'Prix tout inclus (produits, taxes, livraison). Livraison rapide au Congo.'
                  : 'All-inclusive pricing (product, taxes, shipping). Fast delivery to Congo.'}
                <br />
                {isFr ? 'Paiement 100% sécurisé.' : '100% secure payment.'}
              </p>
            </div>

            {/* Right: phone trio image */}
            <div className="hidden md:block relative h-full min-h-[260px]">
              <img
                src={heroTrio}
                alt=""
                aria-hidden
                draggable={false}
                className="absolute right-0 top-1/2 -translate-y-1/2 h-[115%] w-auto object-contain"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
