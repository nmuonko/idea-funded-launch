import React, { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '@/contexts/LanguageContext';
import { ChevronLeft, ChevronRight, ArrowRight } from 'lucide-react';
import { ALL_HOMEPAGE_CATEGORIES, CATEGORY_TITLE_MAP } from '@/lib/categoryConfig';

const CATEGORY_IMAGES: Record<string, string> = {
  phones: 'https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?w=160&h=160&fit=crop',
  electronics: 'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=160&h=160&fit=crop',
  audio_music: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=160&h=160&fit=crop',
  gaming: 'https://images.unsplash.com/photo-1606144042614-b2417e99c4e3?w=160&h=160&fit=crop',
  vehicles: 'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=160&h=160&fit=crop',
  jewelry_watches: 'https://images.unsplash.com/photo-1524592094714-0f0654e20314?w=160&h=160&fit=crop',
  refurbished: 'https://images.unsplash.com/photo-1530893609608-32a9af3aa95c?w=160&h=160&fit=crop',
  cameras_photo: 'https://images.unsplash.com/photo-1516035069371-29a1b244cc32?w=160&h=160&fit=crop',
};

const CATEGORIES = ALL_HOMEPAGE_CATEGORIES.map((key) => ({
  key,
  fr: CATEGORY_TITLE_MAP[key]?.fr || key,
  en: CATEGORY_TITLE_MAP[key]?.en || key,
  image: CATEGORY_IMAGES[key],
})).filter(category => Boolean(category.image));

export const CategoryIconsRow = React.forwardRef<HTMLDivElement, Record<string, never>>(function CategoryIconsRow(_props, _ref) {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -200 : 200, behavior: 'smooth' });
  };

  return (
    <div className="bg-card border border-border rounded-2xl p-4 sm:p-5 shadow-md">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base sm:text-lg font-semibold text-card-foreground">
          {language === 'fr' ? 'Économisez sur les catégories' : 'Save on categories'}
        </h2>
        <button
          onClick={() => navigate('/category/all')}
          className="flex items-center gap-1 text-sm text-primary hover:text-primary/80 font-medium transition-colors"
        >
          {language === 'fr' ? 'Voir tout' : 'See all'}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="relative group">
        <button
          onClick={() => scroll('left')}
          className="absolute -left-2 top-1/2 -translate-y-1/2 z-20 bg-card/90 hover:bg-muted text-card-foreground rounded-full h-8 w-8 items-center justify-center border border-border hidden md:flex opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          onClick={() => scroll('right')}
          className="absolute -right-2 top-1/2 -translate-y-1/2 z-20 bg-card/90 hover:bg-muted text-card-foreground rounded-full h-8 w-8 items-center justify-center border border-border hidden md:flex opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <div
          ref={scrollRef}
          className="flex gap-4 sm:gap-5 overflow-x-auto scrollbar-hide scroll-smooth py-1"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {CATEGORIES.map(({ key, fr, en, image }) => (
            <button
              key={key}
              onClick={() => navigate(`/category/${key}`)}
              className="flex flex-col items-center gap-2 min-w-[72px] sm:min-w-[80px] group/item"
            >
              <div className="w-16 h-16 sm:w-[72px] sm:h-[72px] rounded-full overflow-hidden border border-border group-hover/item:border-primary/40 transition-all">
                <img
                  src={image}
                  alt={language === 'fr' ? fr : en}
                  className="w-full h-full object-cover group-hover/item:scale-110 transition-transform duration-200"
                  loading="lazy"
                />
              </div>
              <span className="text-[11px] sm:text-xs text-muted-foreground group-hover/item:text-foreground text-center leading-tight transition-colors">
                {language === 'fr' ? fr : en}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});
