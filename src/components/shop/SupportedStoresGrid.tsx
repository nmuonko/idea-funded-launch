import { useLanguage } from '@/contexts/LanguageContext';
import { ExternalLink, Car, ShoppingBag } from 'lucide-react';

interface StoreInfo {
  name: string;
  url: string;
  logo: string;
  color: string; // tailwind bg class for the icon ring
}

const stores: StoreInfo[] = [
  { name: 'Amazon', url: 'https://www.amazon.com', logo: '/images/stores/amazon.png', color: 'ring-orange-500/40' },
  { name: 'eBay', url: 'https://www.ebay.com', logo: '/images/stores/ebay.png', color: 'ring-blue-500/40' },
  { name: 'Walmart', url: 'https://www.walmart.com', logo: '/images/stores/walmart.png', color: 'ring-yellow-500/40' },
  { name: 'SHEIN', url: 'https://www.shein.com', logo: '/images/stores/shein.png', color: 'ring-pink-500/40' },
  { name: 'Best Buy', url: 'https://www.bestbuy.com', logo: '/images/stores/bestbuy.png', color: 'ring-blue-600/40' },
  { name: "Macy's", url: 'https://www.macys.com', logo: '/images/stores/macys.png', color: 'ring-red-500/40' },
  { name: 'Home Depot', url: 'https://www.homedepot.com', logo: '/images/stores/homedepot.png', color: 'ring-orange-600/40' },
  { name: 'Wayfair', url: 'https://www.wayfair.com', logo: '/images/stores/wayfair.png', color: 'ring-purple-500/40' },
];

const vehicleStores: StoreInfo[] = [
  { name: 'Ford', url: 'https://www.ford.com', logo: '/images/stores/ford.png', color: 'ring-blue-500/40' },
  { name: 'Toyota', url: 'https://www.toyota.com', logo: '/images/stores/toyota.png', color: 'ring-red-500/40' },
  { name: 'Tesla', url: 'https://www.tesla.com', logo: '/images/stores/tesla.png', color: 'ring-slate-400/40' },
];

function StorePill({ store }: { store: StoreInfo }) {
  return (
    <a
      href={store.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col items-center gap-2 py-2.5 px-1 rounded-xl hover:bg-white/[0.04] transition-colors"
    >
      <div className={`w-full max-w-[96px] h-12 rounded-xl bg-white ring-2 ${store.color} flex items-center justify-center overflow-hidden shadow-md shadow-black/20 group-hover:scale-[1.03] transition-transform px-2`}>
        <img
          src={store.logo}
          alt={`${store.name} logo`}
          className="w-full h-full object-contain"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
            const parent = (e.target as HTMLImageElement).parentElement;
            if (parent) {
              parent.innerHTML = `<span class=\"text-sm font-bold text-gray-700\">${store.name}</span>`;
            }
          }}
        />
      </div>
      <div className="flex items-center gap-1">
        <span className="text-xs text-white/70 group-hover:text-white transition-colors font-medium">
          {store.name}
        </span>
        <ExternalLink className="h-2.5 w-2.5 text-white/25 group-hover:text-white/60 transition-colors" />
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
