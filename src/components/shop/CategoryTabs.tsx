import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Smartphone, Car, Gamepad2, Shirt, Home, Sparkles, Watch, Dumbbell, Cpu, Package } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';
import { cn } from '@/lib/utils';

// Helper function to get localized fallback from shop translations
const getLocalizedFallback = (key: string, shop: Record<string, string>): string | undefined => {
  const keyMap: Record<string, string> = {
    electronics: 'electronics',
    vehicles: 'vehicles',
    home_garden: 'homeGarden',
    clothing_shoes_accessories: 'clothingFashion',
    toys: 'toys',
    sporting_goods: 'sportingGoods',
    jewelry_watches: 'jewelryWatches',
    refurbished: 'refurbished',
    parts_accessories: 'partsAccessories',
    phones: 'phones',
    fashion: 'fashion',
    home: 'home',
    beauty: 'beauty',
    watches: 'watches',
    fitness: 'fitness',
  };
  const shopKey = keyMap[key];
  return shopKey ? shop[shopKey] : undefined;
};

interface CategoryTab {
  key: string;
  title: string;
  icon: React.ReactNode;
}

interface CategoryTabsProps {
  activeCategory?: string;
  onCategoryChange?: (category: string) => void;
  className?: string;
}

export function CategoryTabs({ activeCategory, onCategoryChange, className }: CategoryTabsProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { language } = useLanguage();
  const [tabs, setTabs] = useState<CategoryTab[]>([]);
  const currentCategory = activeCategory || searchParams.get('category') || 'all';

  const t = translations[language] || translations.en;
  const shop = t.shop;

  // Build default tabs with i18n — keys MUST match backend recipe keys exactly
  const getDefaultTabs = (): CategoryTab[] => [
    { key: 'all', title: shop.all, icon: <Home className="h-4 w-4" /> },
    { key: 'phones', title: shop.phones || 'Téléphones', icon: <Smartphone className="h-4 w-4" /> },
    { key: 'electronics', title: shop.electronics || 'Électronique', icon: <Cpu className="h-4 w-4" /> },
    { key: 'vehicles', title: shop.vehicles, icon: <Car className="h-4 w-4" /> },
    { key: 'gaming', title: shop.gaming, icon: <Gamepad2 className="h-4 w-4" /> },
    { key: 'clothing', title: shop.clothingFashion || shop.fashion || 'Mode', icon: <Shirt className="h-4 w-4" /> },
    { key: 'home_garden', title: shop.homeGarden || shop.home || 'Maison', icon: <Home className="h-4 w-4" /> },
    { key: 'toys', title: shop.toys || shop.toysGames || 'Jouets', icon: <Gamepad2 className="h-4 w-4" /> },
    { key: 'sporting_goods', title: shop.sportingGoods || shop.sportsOutdoors || 'Sport', icon: <Dumbbell className="h-4 w-4" /> },
    { key: 'jewelry_watches', title: shop.jewelryWatches || shop.watches || 'Montres', icon: <Watch className="h-4 w-4" /> },
    { key: 'parts_accessories', title: shop.partsAccessories || 'Pièces Auto', icon: <Package className="h-4 w-4" /> },
    { key: 'refurbished', title: shop.refurbished || 'Reconditionné', icon: <Sparkles className="h-4 w-4" /> },
  ];

  // Update tabs when language changes
  useEffect(() => {
    setTabs(getDefaultTabs());
  }, [language]);

  // Fetch categories from backend (optional enhancement)
  useEffect(() => {
    const fetchTabs = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('catalog-tabs');
        if (!error && data?.tabs) {
          const iconMap: Record<string, React.ReactNode> = {
            phones: <Smartphone className="h-4 w-4" />,
            vehicles: <Car className="h-4 w-4" />,
            gaming: <Gamepad2 className="h-4 w-4" />,
            fashion: <Shirt className="h-4 w-4" />,
            clothing_shoes_accessories: <Shirt className="h-4 w-4" />,
            home: <Home className="h-4 w-4" />,
            home_garden: <Home className="h-4 w-4" />,
            beauty: <Sparkles className="h-4 w-4" />,
            watches: <Watch className="h-4 w-4" />,
            jewelry_watches: <Watch className="h-4 w-4" />,
            fitness: <Dumbbell className="h-4 w-4" />,
            sporting_goods: <Dumbbell className="h-4 w-4" />,
            electronics: <Cpu className="h-4 w-4" />,
            computers: <Cpu className="h-4 w-4" />,
            toys: <Gamepad2 className="h-4 w-4" />,
          };
          
          // Get localized title based on language
          // Only filter out business_industrial; keep all other valid tabs
          const filteredTabs = data.tabs
            .filter((tab: any) => tab.key !== 'business_industrial');
          
          const seen = new Set<string>();
          seen.add('all');
          seen.add('gaming'); // reserve slot for gaming tab
          const mappedTabs: CategoryTab[] = [
            { key: 'all', title: shop.all, icon: <Home className="h-4 w-4" /> },
            { key: 'gaming', title: shop.gaming || 'Gaming', icon: <Gamepad2 className="h-4 w-4" /> },
            ...filteredTabs
              .filter((tab: any) => {
                if (seen.has(tab.key)) return false;
                seen.add(tab.key);
                return true;
              })
              .map((tab: any) => ({
                key: tab.key,
                title: language === 'fr' && tab.title_fr ? tab.title_fr 
                     : language === 'sw' && tab.title_sw ? tab.title_sw
                     : language === 'ln' && tab.title_ln ? tab.title_ln
                     : language === 'en' && tab.title_en ? tab.title_en
                     : getLocalizedFallback(tab.key, shop) || tab.title_en || tab.title,
                icon: iconMap[tab.key] || <Package className="h-4 w-4" />,
              })),
          ];
          setTabs(mappedTabs);
        }
      } catch (error) {
        console.error('Failed to fetch category tabs:', error);
        // Keep default tabs on error
      }
    };
    
    fetchTabs();
  }, [language]);

  const handleTabClick = (category: string) => {
    if (onCategoryChange) {
      onCategoryChange(category);
    } else {
      if (category === 'all') {
        navigate('/');
      } else {
        navigate(`/search?category=${category}`);
      }
    }
  };

  return (
    <ScrollArea className={cn("w-full", className)}>
      <div className="flex gap-2 py-2 snap-x snap-mandatory">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabClick(tab.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap min-h-[44px] snap-start",
              currentCategory === tab.key
                ? "bg-gradient-to-r from-blue-500 to-cyan-500 text-white"
                : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white border border-white/10"
            )}
          >
            {tab.icon}
            <span className="whitespace-nowrap">{tab.title}</span>
          </button>
        ))}
      </div>
      <ScrollBar orientation="horizontal" className="invisible" />
    </ScrollArea>
  );
}
