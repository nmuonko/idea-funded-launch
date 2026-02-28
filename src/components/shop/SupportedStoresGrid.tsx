import { useLanguage } from '@/contexts/LanguageContext';
import { ExternalLink } from 'lucide-react';

const stores = [
  { name: 'Amazon', url: 'https://www.amazon.com', color: 'bg-orange-500/20 text-orange-400' },
  { name: 'eBay', url: 'https://www.ebay.com', color: 'bg-blue-500/20 text-blue-400' },
  { name: 'Walmart', url: 'https://www.walmart.com', color: 'bg-yellow-500/20 text-yellow-400' },
  { name: 'SHEIN', url: 'https://www.shein.com', color: 'bg-pink-500/20 text-pink-400' },
  { name: 'Best Buy', url: 'https://www.bestbuy.com', color: 'bg-blue-600/20 text-blue-300' },
  { name: "Macy's", url: 'https://www.macys.com', color: 'bg-red-500/20 text-red-400' },
  { name: 'Home Depot', url: 'https://www.homedepot.com', color: 'bg-orange-600/20 text-orange-300' },
  { name: 'Wayfair', url: 'https://www.wayfair.com', color: 'bg-purple-500/20 text-purple-400' },
  { name: 'Carvana', url: 'https://www.carvana.com', color: 'bg-cyan-500/20 text-cyan-400', isVehicle: true },
  { name: 'CarGurus', url: 'https://www.cargurus.com', color: 'bg-green-500/20 text-green-400', isVehicle: true },
];

export function SupportedStoresGrid() {
  const { language } = useLanguage();
  const title = language === 'fr' ? 'Magasins supportés' : 'Supported Stores';
  const subtitle = language === 'fr'
    ? 'Cliquez pour parcourir, puis collez le lien du produit ci-dessus'
    : 'Click to browse, then paste the product link above';

  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
      <p className="text-xs text-muted-foreground mb-4">{subtitle}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {stores.map((store) => (
          <a
            key={store.name}
            href={store.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`flex items-center gap-2 px-3 py-3 rounded-xl border border-border/50 ${store.color} hover:border-primary/40 transition-all group`}
          >
            <span className="text-sm font-medium flex-1">{store.name}</span>
            {store.isVehicle && (
              <span className="text-[9px] bg-warning/20 text-warning px-1.5 py-0.5 rounded-full">
                {language === 'fr' ? 'Devis' : 'Quote'}
              </span>
            )}
            <ExternalLink className="h-3.5 w-3.5 opacity-40 group-hover:opacity-80 transition-opacity" />
          </a>
        ))}
      </div>
    </div>
  );
}
