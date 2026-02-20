import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '@/contexts/LanguageContext';
import { useNavigate } from 'react-router-dom';
import heroGaming from '@/assets/hero-gaming.jpg';
import heroPhones from '@/assets/hero-phones.jpg';
import boseHeadphones from '@/assets/bose-headphones.png';

interface Slide {
  titleFr: string;
  titleEn: string;
  subtitleFr: string;
  subtitleEn: string;
  ctaFr: string;
  ctaEn: string;
  ctaLink: string;
  gradient: string;
  image?: string;
}

const SLIDES: Slide[] = [
  {
    titleFr: 'Offres Gaming',
    titleEn: 'Gaming Deals',
    subtitleFr: 'PS5, Xbox, Nintendo Switch — livrés chez vous en RDC',
    subtitleEn: 'PS5, Xbox, Nintendo Switch — delivered to DRC',
    ctaFr: 'Voir les offres',
    ctaEn: 'See deals',
    ctaLink: '/category/gaming',
    gradient: 'from-indigo-900/90 via-purple-900/70 to-transparent',
    image: heroGaming,
  },
  {
    titleFr: 'Livraison en 2-4 Semaines',
    titleEn: 'Delivery in 2-4 Weeks',
    subtitleFr: "Des USA, directement à votre porte en RDC",
    subtitleEn: 'From the USA, straight to your door in DRC',
    ctaFr: 'Acheter maintenant',
    ctaEn: 'Shop now',
    ctaLink: '/shop',
    gradient: 'from-black/80 via-black/50 to-transparent',
    image: '/hero-airplane.jpg',
  },
  {
    titleFr: 'Smartphones Premium',
    titleEn: 'Premium Smartphones',
    subtitleFr: 'iPhone, Samsung Galaxy — les meilleurs prix garantis',
    subtitleEn: 'iPhone, Samsung Galaxy — best prices guaranteed',
    ctaFr: 'Voir les téléphones',
    ctaEn: 'See phones',
    ctaLink: '/category/phones',
    gradient: 'from-emerald-900/80 via-teal-900/60 to-transparent',
    image: heroPhones,
  },
  {
    titleFr: 'Laptops & Ordinateurs',
    titleEn: 'Laptops & Computers',
    subtitleFr: 'MacBook Pro, Microsoft Surface — puissance et performance',
    subtitleEn: 'MacBook Pro, Microsoft Surface — power and performance',
    ctaFr: 'Voir les laptops',
    ctaEn: 'See laptops',
    ctaLink: '/category/computers',
    gradient: 'from-slate-900/90 via-blue-900/70 to-transparent',
    image: 'https://images.unsplash.com/photo-1611186871348-b1ce696e52c9?w=1600&q=80&auto=format&fit=crop',
  },
  {
    titleFr: 'Audio & Casques',
    titleEn: 'Audio & Headphones',
    subtitleFr: 'Bose, Sony, AirPods — son premium garanti',
    subtitleEn: 'Bose, Sony, AirPods — premium sound guaranteed',
    ctaFr: 'Voir les casques',
    ctaEn: 'See headphones',
    ctaLink: '/category/audio',
    gradient: 'from-amber-900/90 via-orange-900/70 to-transparent',
    image: boseHeadphones,
  },
  {
    titleFr: 'Maison Connectée',
    titleEn: 'Smart Home & Accessories',
    subtitleFr: 'Echo, Google Home, Ring — votre maison intelligente',
    subtitleEn: 'Echo, Google Home, Ring — your smart home awaits',
    ctaFr: 'Voir les accessoires',
    ctaEn: 'See accessories',
    ctaLink: '/category/accessories',
    gradient: 'from-rose-900/90 via-pink-900/70 to-transparent',
    image: 'https://images.unsplash.com/photo-1558089687-f282ffcbc126?w=1600&q=80&auto=format&fit=crop',
  },
];

export function HeroBannerCarousel() {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);

  const next = useCallback(() => setCurrent(i => (i + 1) % SLIDES.length), []);
  const prev = useCallback(() => setCurrent(i => (i - 1 + SLIDES.length) % SLIDES.length), []);

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(next, 10000);
    return () => clearInterval(timer);
  }, [paused, next]);

  const slide = SLIDES[current];

  return (
    <div
      className="container mx-auto px-3 sm:px-4"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative overflow-hidden rounded-2xl h-[170px] sm:h-[220px] md:h-[300px] lg:h-[340px] border border-white/10">
        <AnimatePresence mode="wait">
          <motion.div
            key={current}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0"
          >
            {slide.image && (
              <img
                src={slide.image}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
              />
            )}
            <div className={`absolute inset-0 bg-gradient-to-r ${slide.gradient}`} />
          </motion.div>
        </AnimatePresence>

        <div className="relative z-10 h-full flex flex-col justify-center px-6 md:px-12 max-w-xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={current}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.35 }}
            >
              <h2 className="text-xl sm:text-2xl md:text-4xl font-bold text-white drop-shadow-lg mb-1 md:mb-2">
                {language === 'fr' ? slide.titleFr : slide.titleEn}
              </h2>
              <p className="text-white/85 text-xs sm:text-sm md:text-base drop-shadow mb-3 md:mb-5 max-w-sm">
                {language === 'fr' ? slide.subtitleFr : slide.subtitleEn}
              </p>
              <button
                onClick={() => navigate(slide.ctaLink)}
                className="bg-white/90 hover:bg-white text-gray-900 font-semibold text-xs sm:text-sm px-4 py-2 sm:px-5 sm:py-2.5 rounded-full transition-colors shadow-lg"
              >
                {language === 'fr' ? slide.ctaFr : slide.ctaEn}
              </button>
            </motion.div>
          </AnimatePresence>
        </div>

        <button
          onClick={prev}
          className="absolute left-2 md:left-3 top-1/2 -translate-y-1/2 z-20 bg-black/40 hover:bg-black/60 text-white rounded-full p-1.5 md:p-2 transition-colors backdrop-blur-sm border border-white/10"
          aria-label="Previous"
        >
          <ChevronLeft className="h-4 w-4 md:h-5 md:w-5" />
        </button>
        <button
          onClick={next}
          className="absolute right-2 md:right-3 top-1/2 -translate-y-1/2 z-20 bg-black/40 hover:bg-black/60 text-white rounded-full p-1.5 md:p-2 transition-colors backdrop-blur-sm border border-white/10"
          aria-label="Next"
        >
          <ChevronRight className="h-4 w-4 md:h-5 md:w-5" />
        </button>

        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex gap-1.5">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrent(i)}
              className={`rounded-full transition-all duration-300 ${
                i === current
                  ? 'w-6 h-2 bg-white'
                  : 'w-2 h-2 bg-white/40 hover:bg-white/60'
              }`}
              aria-label={`Go to slide ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
