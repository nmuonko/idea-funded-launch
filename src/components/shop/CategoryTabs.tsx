import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Smartphone, Car, Gamepad2, Shirt, Home, Sparkles, Watch, Dumbbell, Cpu, Package, ChevronLeft, ChevronRight } from 'lucide-react';
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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
    { key: 'kitchen', title: shop.kitchen || 'Électroménager', icon: <Home className="h-4 w-4" /> },
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
        const { data, error } = await supabase.functions.invoke('catalog-service?action=tabs');
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

  // Scroll state detection
  const updateScrollState = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      ro.disconnect();
    };
  }, [tabs]);

  const scroll = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -200 : 200, behavior: 'smooth' });
  };

  const handleTabClick = (category: string) => {
    if (category === 'all') {
      navigate('/');
    } else {
      navigate(`/?tab=${category}`);
    }
    if (onCategoryChange) {
      onCategoryChange(category);
    }
  };

  return (
    <div className={cn("relative w-full", className)}>
      {/* Left arrow */}
      {canScrollLeft && (
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-20 h-9 w-9 flex items-center justify-center rounded-full bg-[#111318]/90 border border-white/10 text-white/80 hover:text-white hover:bg-[#1a1d23] shadow-lg"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}
      
      {/* Right fade gradient */}
      {canScrollRight && (
        <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-14 bg-gradient-to-l from-[#111318] to-transparent z-10" />
      )}
      
      {/* Right arrow */}
      {canScrollRight && (
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-20 h-9 w-9 flex items-center justify-center rounded-full bg-[#111318]/90 border border-white/10 text-white/80 hover:text-white hover:bg-[#1a1d23] shadow-lg"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}

      <div
        ref={scrollRef}
        className="flex gap-2 py-2 overflow-x-auto scrollbar-none pr-6"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabClick(tab.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap min-h-[40px] flex-shrink-0",
              currentCategory === tab.key
                ? "bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-md shadow-blue-500/20"
                : "bg-white/[0.08] text-white/70 hover:bg-white/[0.12] hover:text-white border border-white/10"
            )}
          >
            {tab.icon}
            <span>{tab.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
