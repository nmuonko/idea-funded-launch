import { useLanguage } from '@/contexts/LanguageContext';
import { ExternalLink, Car, ShoppingBag } from 'lucide-react';

interface StoreInfo {
  name: string;
  url: string;
  logo: string;
  color: string; // tailwind bg class for the icon ring
}

const stores: StoreInfo[] = [
  { name: 'Amazon', url: 'https://www.amazon.com', logo: 'https://logo.clearbit.com/amazon.com', color: 'ring-orange-500/40' },
  { name: 'eBay', url: 'https://www.ebay.com', logo: 'https://logo.clearbit.com/ebay.com', color: 'ring-blue-500/40' },
  { name: 'Walmart', url: 'https://www.walmart.com', logo: 'https://logo.clearbit.com/walmart.com', color: 'ring-yellow-500/40' },
  { name: 'SHEIN', url: 'https://www.shein.com', logo: 'https://logo.clearbit.com/shein.com', color: 'ring-pink-500/40' },
  { name: 'Best Buy', url: 'https://www.bestbuy.com', logo: 'https://logo.clearbit.com/bestbuy.com', color: 'ring-blue-600/40' },
  { name: "Macy's", url: 'https://www.macys.com', logo: 'https://logo.clearbit.com/macys.com', color: 'ring-red-500/40' },
  { name: 'Home Depot', url: 'https://www.homedepot.com', logo: 'https://logo.clearbit.com/homedepot.com', color: 'ring-orange-600/40' },
  { name: 'Wayfair', url: 'https://www.wayfair.com', logo: 'https://logo.clearbit.com/wayfair.com', color: 'ring-purple-500/40' },
];

const vehicleStores: StoreInfo[] = [
  { name: 'Ford', url: 'https://www.ford.com', logo: 'https://logo.clearbit.com/ford.com', color: 'ring-blue-500/40' },
  { name: 'Toyota', url: 'https://www.toyota.com', logo: 'https://logo.clearbit.com/toyota.com', color: 'ring-red-500/40' },
  { name: 'Tesla', url: 'https://www.tesla.com', logo: 'https://logo.clearbit.com/tesla.com', color: 'ring-slate-400/40' },
];

function StorePill({ store }: { store: StoreInfo }) {
  return (
    <a
      href={store.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col items-center gap-2 py-3 px-2 rounded-xl hover:bg-white/[0.04] transition-colors"
    >
      <div className={`w-12 h-12 rounded-2xl bg-white ring-2 ${store.color} flex items-center justify-center overflow-hidden shadow-md shadow-black/20 group-hover:scale-105 transition-transform`}>
        <img
          src={store.logo}
          alt={store.name}
          className="w-8 h-8 object-contain"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
            const parent = (e.target as HTMLImageElement).parentElement;
            if (parent) {
              parent.innerHTML = `<span class="text-base font-bold text-gray-700">${store.name[0]}</span>`;
            }
          }}
        />
      </div>
      <div className="flex items-center gap-1">
        <span className="text-xs text-white/60 group-hover:text-white/90 transition-colors font-medium">
          {store.name}
        </span>
        <ExternalLink className="h-2.5 w-2.5 text-white/20 group-hover:text-white/50 transition-colors" />
      </div>
    </a>
  );
}

export function SupportedStoresGrid() {
  const { language } = useLanguage();

  return (
    <div className="mt-8 space-y-6">
      {/* General Stores */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#1a1d23]/60 p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-1">
          <ShoppingBag className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-white/90">
            {language === 'fr' ? 'Magasins populaires' : 'Popular Stores'}
          </h3>
        </div>
        <p className="text-[11px] text-white/35 mb-4 ml-6">
          {language === 'fr'
            ? 'Parcourez, trouvez un produit, puis collez le lien ci-dessus'
            : 'Browse, find a product, then paste the link above'}
        </p>
        <div className="grid grid-cols-4 sm:grid-cols-4 gap-1">
          {stores.map((store) => (
            <StorePill key={store.name} store={store} />
          ))}
        </div>
      </div>

      {/* Vehicle Stores */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#1a1d23]/60 p-4 sm:p-5">
        <div className="flex items-center gap-2 mb-1">
          <Car className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-white/90">
            {language === 'fr' ? 'Véhicules' : 'Vehicles'}
          </h3>
          <span className="text-[10px] bg-primary/10 text-primary/80 px-2 py-0.5 rounded-full border border-primary/15 font-medium">
            {language === 'fr' ? 'Devis requis' : 'Quote only'}
          </span>
        </div>
        <p className="text-[11px] text-white/35 mb-4 ml-6">
          {language === 'fr'
            ? 'Collez un lien véhicule pour demander un devis personnalisé'
            : 'Paste a vehicle link to request a custom quote'}
        </p>
        <div className="grid grid-cols-3 gap-1">
          {vehicleStores.map((store) => (
            <StorePill key={store.name} store={store} />
          ))}
        </div>
      </div>

      {/* Any store note */}
      <div className="text-center pb-4">
        <p className="text-xs text-white/25">
          {language === 'fr'
            ? '+ tout autre magasin en ligne avec un lien produit'
            : '+ any other online store with a product link'}
        </p>
      </div>
    </div>
  );
}
