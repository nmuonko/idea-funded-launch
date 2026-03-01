import { useLanguage } from '@/contexts/LanguageContext';
import { ExternalLink, Car } from 'lucide-react';

const stores = [
  {
    name: 'Amazon',
    url: 'https://www.amazon.com',
    logo: 'https://logo.clearbit.com/amazon.com',
    gradient: 'from-orange-500/20 to-orange-600/5',
    accent: 'border-orange-500/30 hover:border-orange-400/60',
    textColor: 'text-orange-400',
  },
  {
    name: 'eBay',
    url: 'https://www.ebay.com',
    logo: 'https://logo.clearbit.com/ebay.com',
    gradient: 'from-blue-500/20 to-blue-600/5',
    accent: 'border-blue-500/30 hover:border-blue-400/60',
    textColor: 'text-blue-400',
  },
  {
    name: 'Walmart',
    url: 'https://www.walmart.com',
    logo: 'https://logo.clearbit.com/walmart.com',
    gradient: 'from-yellow-500/20 to-yellow-600/5',
    accent: 'border-yellow-500/30 hover:border-yellow-400/60',
    textColor: 'text-yellow-400',
  },
  {
    name: 'SHEIN',
    url: 'https://www.shein.com',
    logo: 'https://logo.clearbit.com/shein.com',
    gradient: 'from-pink-500/20 to-pink-600/5',
    accent: 'border-pink-500/30 hover:border-pink-400/60',
    textColor: 'text-pink-400',
  },
  {
    name: 'Best Buy',
    url: 'https://www.bestbuy.com',
    logo: 'https://logo.clearbit.com/bestbuy.com',
    gradient: 'from-blue-600/20 to-blue-700/5',
    accent: 'border-blue-600/30 hover:border-blue-500/60',
    textColor: 'text-blue-300',
  },
  {
    name: "Macy's",
    url: 'https://www.macys.com',
    logo: 'https://logo.clearbit.com/macys.com',
    gradient: 'from-red-500/20 to-red-600/5',
    accent: 'border-red-500/30 hover:border-red-400/60',
    textColor: 'text-red-400',
  },
  {
    name: 'Home Depot',
    url: 'https://www.homedepot.com',
    logo: 'https://logo.clearbit.com/homedepot.com',
    gradient: 'from-orange-600/20 to-orange-700/5',
    accent: 'border-orange-600/30 hover:border-orange-500/60',
    textColor: 'text-orange-300',
  },
  {
    name: 'Wayfair',
    url: 'https://www.wayfair.com',
    logo: 'https://logo.clearbit.com/wayfair.com',
    gradient: 'from-purple-500/20 to-purple-600/5',
    accent: 'border-purple-500/30 hover:border-purple-400/60',
    textColor: 'text-purple-400',
  },
];

const vehicleStores = [
  {
    name: 'Ford',
    url: 'https://www.ford.com',
    logo: 'https://logo.clearbit.com/ford.com',
    gradient: 'from-blue-500/20 to-blue-600/5',
    accent: 'border-blue-500/30 hover:border-blue-400/60',
    textColor: 'text-blue-400',
  },
  {
    name: 'Toyota',
    url: 'https://www.toyota.com',
    logo: 'https://logo.clearbit.com/toyota.com',
    gradient: 'from-red-500/20 to-red-600/5',
    accent: 'border-red-500/30 hover:border-red-400/60',
    textColor: 'text-red-400',
  },
  {
    name: 'Tesla',
    url: 'https://www.tesla.com',
    logo: 'https://logo.clearbit.com/tesla.com',
    gradient: 'from-slate-400/20 to-slate-500/5',
    accent: 'border-slate-400/30 hover:border-slate-300/60',
    textColor: 'text-slate-300',
  },
];

function StoreCard({ store, isVehicle, language }: { store: typeof stores[0]; isVehicle?: boolean; language: string }) {
  return (
    <a
      href={store.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`group relative flex items-center gap-3 px-4 py-3.5 rounded-xl border bg-gradient-to-br ${store.gradient} ${store.accent} transition-all hover:shadow-lg hover:shadow-black/20 hover:scale-[1.02] active:scale-[0.98]`}
    >
      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center overflow-hidden">
        <img
          src={store.logo}
          alt={store.name}
          className="w-6 h-6 object-contain"
          onError={(e) => {
            // Fallback: hide image and show first letter
            (e.target as HTMLImageElement).style.display = 'none';
            const parent = (e.target as HTMLImageElement).parentElement;
            if (parent) {
              parent.innerHTML = `<span class="text-sm font-bold ${store.textColor}">${store.name[0]}</span>`;
            }
          }}
        />
      </div>
      <span className={`text-sm font-semibold flex-1 ${store.textColor}`}>{store.name}</span>
      {isVehicle && (
        <span className="text-[9px] font-medium bg-primary/20 text-primary px-2 py-0.5 rounded-full border border-primary/20">
          {language === 'fr' ? 'Devis' : 'Quote'}
        </span>
      )}
      <ExternalLink className="h-3.5 w-3.5 opacity-30 group-hover:opacity-70 transition-opacity text-muted-foreground" />
    </a>
  );
}

export function SupportedStoresGrid() {
  const { language } = useLanguage();

  return (
    <div className="mt-8 space-y-6">
      {/* General Stores */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-1">
          {language === 'fr' ? 'Magasins supportés' : 'Supported Stores'}
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          {language === 'fr'
            ? 'Cliquez pour parcourir, puis collez le lien du produit ci-dessus'
            : 'Click to browse, then paste the product link above'}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {stores.map((store) => (
            <StoreCard key={store.name} store={store} language={language} />
          ))}
        </div>
      </div>

      {/* Vehicle Stores */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Car className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">
            {language === 'fr' ? 'Véhicules' : 'Vehicles'}
          </h3>
          <span className="text-[10px] bg-primary/15 text-primary px-2 py-0.5 rounded-full border border-primary/20">
            {language === 'fr' ? 'Devis requis' : 'Quote required'}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {vehicleStores.map((store) => (
            <StoreCard key={store.name} store={store} isVehicle language={language} />
          ))}
        </div>
      </div>
    </div>
  );
}
