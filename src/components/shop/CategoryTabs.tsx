import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Smartphone, Car, Gamepad2, Shirt, Home, Sparkles, Watch, Dumbbell, Cpu, Package } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';
import { cn } from '@/lib/utils';

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
  const currentCategory = activeCategory || searchParams.get('tab') || 'all';

  const t = translations[language] || translations.en;
  const shop = t.shop;

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

  useEffect(() => {
    setTabs(getDefaultTabs());
  }, [language]);

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
          
          const filteredTabs = data.tabs
            .filter((tab: any) => tab.key !== 'business_industrial');
          
          const seen = new Set<string>();
          seen.add('all');
          seen.add('gaming');
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
      }
    };
    
    fetchTabs();
  }, [language]);

  const handleTabClick = (category: string) => {
    // Always update URL with ?tab= param for proper back-button support
    if (category === 'all') {
      navigate('/');
    } else {
      navigate(`/?tab=${category}`);
    }
    // Also call parent callback if provided
    if (onCategoryChange) {
      onCategoryChange(category);
    }
  };

  return (
    <div className={cn("relative w-full", className)}>
      <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-black to-transparent z-10 md:w-16" />
      <ScrollArea className="w-full">
        <div className="flex gap-2 py-2 snap-x snap-mandatory pr-12 md:pr-16">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleTabClick(tab.key)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap min-h-[44px] snap-start",
                currentCategory === tab.key
                  ? "bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-md shadow-blue-500/20"
                  : "bg-white/[0.08] text-white/70 hover:bg-white/[0.12] hover:text-white border border-white/10"
              )}
            >
              {tab.icon}
              <span className="whitespace-nowrap">{tab.title}</span>
            </button>
          ))}
        </div>
        <ScrollBar orientation="horizontal" className="invisible" />
      </ScrollArea>
    </div>
  );
}
