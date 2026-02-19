import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { ChevronLeft, ChevronRight, Smartphone, Monitor, Gamepad2, Car, Sofa, Gift, Watch, Shirt, Wrench, RotateCcw, Trophy, ArrowRight } from 'lucide-react';

const CATEGORIES = [
  { key: 'phones', icon: Smartphone, fr: 'Téléphones', en: 'Phones' },
  { key: 'electronics', icon: Monitor, fr: 'Électronique', en: 'Electronics' },
  { key: 'gaming', icon: Gamepad2, fr: 'Jeux Vidéo', en: 'Gaming' },
  { key: 'vehicles', icon: Car, fr: 'Véhicules', en: 'Vehicles' },
  { key: 'home_garden', icon: Sofa, fr: 'Cuisine & Salon', en: 'Home & Living' },
  { key: 'toys', icon: Gift, fr: 'Jouets', en: 'Toys' },
  { key: 'jewelry_watches', icon: Watch, fr: 'Montres', en: 'Watches' },
  { key: 'clothing', icon: Shirt, fr: 'Mode', en: 'Fashion' },
  { key: 'sporting_goods', icon: Trophy, fr: 'Sport', en: 'Sports' },
  { key: 'parts_accessories', icon: Wrench, fr: 'Pièces Auto', en: 'Auto Parts' },
  { key: 'refurbished', icon: RotateCcw, fr: 'Reconditionné', en: 'Refurbished' },
];

export function CategoryIconsRow() {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -200 : 200, behavior: 'smooth' });
  };

  return (
    <div className="bg-[#1a1d23] border border-white/[0.08] rounded-2xl p-4 sm:p-5 shadow-md">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base sm:text-lg font-semibold text-white/95">
          {language === 'fr' ? 'Économisez sur les catégories' : 'Save on categories'}
        </h2>
        <button
          onClick={() => navigate('/shop')}
          className="flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 font-medium transition-colors"
        >
          {language === 'fr' ? 'Voir tout' : 'See all'}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="relative group">
        {/* Arrows */}
        <button
          onClick={() => scroll('left')}
          className="absolute -left-2 top-1/2 -translate-y-1/2 z-20 bg-[#1a1d23]/90 hover:bg-[#252830] text-white rounded-full h-8 w-8 items-center justify-center border border-white/10 hidden md:flex opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          onClick={() => scroll('right')}
          className="absolute -right-2 top-1/2 -translate-y-1/2 z-20 bg-[#1a1d23]/90 hover:bg-[#252830] text-white rounded-full h-8 w-8 items-center justify-center border border-white/10 hidden md:flex opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <div
          ref={scrollRef}
          className="flex gap-4 sm:gap-5 overflow-x-auto scrollbar-hide scroll-smooth py-1"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {CATEGORIES.map(({ key, icon: Icon, fr, en }) => (
            <button
              key={key}
              onClick={() => navigate(`/category/${key}`)}
              className="flex flex-col items-center gap-2 min-w-[72px] sm:min-w-[80px] group/item"
            >
              <div className="w-16 h-16 sm:w-[72px] sm:h-[72px] rounded-full bg-white/[0.07] border border-white/10 flex items-center justify-center group-hover/item:bg-white/[0.12] group-hover/item:border-white/20 transition-all">
                <Icon className="h-6 w-6 sm:h-7 sm:w-7 text-white/80 group-hover/item:text-white transition-colors" />
              </div>
              <span className="text-[11px] sm:text-xs text-white/70 group-hover/item:text-white/90 text-center leading-tight transition-colors">
                {language === 'fr' ? fr : en}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
