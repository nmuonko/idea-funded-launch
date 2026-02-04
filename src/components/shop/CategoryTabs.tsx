import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Smartphone, Car, Gamepad2, Shirt, Home, Sparkles, Watch, Dumbbell, Cpu, Package } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';
import { cn } from '@/lib/utils';

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

  // Build default tabs with i18n
  const getDefaultTabs = (): CategoryTab[] => [
    { key: 'all', title: shop.all, icon: <Package className="h-4 w-4" /> },
    { key: 'phones', title: shop.phones, icon: <Smartphone className="h-4 w-4" /> },
    { key: 'vehicles', title: shop.vehicles, icon: <Car className="h-4 w-4" /> },
    { key: 'gaming', title: shop.gaming, icon: <Gamepad2 className="h-4 w-4" /> },
    { key: 'fashion', title: shop.fashion, icon: <Shirt className="h-4 w-4" /> },
    { key: 'home', title: shop.home, icon: <Home className="h-4 w-4" /> },
    { key: 'beauty', title: shop.beauty, icon: <Sparkles className="h-4 w-4" /> },
    { key: 'watches', title: shop.watches, icon: <Watch className="h-4 w-4" /> },
    { key: 'fitness', title: shop.fitness, icon: <Dumbbell className="h-4 w-4" /> },
    { key: 'electronics', title: shop.electronics, icon: <Cpu className="h-4 w-4" /> },
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
            home: <Home className="h-4 w-4" />,
            beauty: <Sparkles className="h-4 w-4" />,
            watches: <Watch className="h-4 w-4" />,
            fitness: <Dumbbell className="h-4 w-4" />,
            electronics: <Cpu className="h-4 w-4" />,
          };
          
          // Get localized title based on language
          const mappedTabs: CategoryTab[] = [
            { key: 'all', title: shop.all, icon: <Package className="h-4 w-4" /> },
            ...data.tabs.map((tab: any) => ({
              key: tab.key,
              title: language === 'fr' && tab.title_fr ? tab.title_fr :
                     language === 'en' && tab.title_en ? tab.title_en :
                     tab.title_en || tab.title,
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
        navigate('/shop');
      } else {
        navigate(`/shop/search?category=${category}`);
      }
    }
  };

  return (
    <ScrollArea className={cn("w-full whitespace-nowrap", className)}>
      <div className="flex gap-2 py-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabClick(tab.key)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap",
              currentCategory === tab.key
                ? "bg-gradient-to-r from-blue-500 to-cyan-500 text-white"
                : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white border border-white/10"
            )}
          >
            {tab.icon}
            {tab.title}
          </button>
        ))}
      </div>
      <ScrollBar orientation="horizontal" className="invisible" />
    </ScrollArea>
  );
}
