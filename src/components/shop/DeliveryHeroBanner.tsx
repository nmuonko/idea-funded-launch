import { motion } from 'framer-motion';
import { Plane, Package } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

export function DeliveryHeroBanner() {
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = t.shop as Record<string, string>;

  return (
    <div className="container mx-auto px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative overflow-hidden rounded-2xl h-40 md:h-60 border border-white/10 bg-white/5"
      >
        {/* Background Image - Real airplane photo */}
        <img 
          src="/hero-airplane.jpg"
          alt="Cargo airplane in flight"
          className="absolute inset-0 w-full h-full object-cover object-center"
        />
        
        {/* Dark gradient overlay from left to transparent right */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-transparent" />
        
        {/* Content Overlay */}
        <div className="relative z-10 h-full flex flex-col justify-center px-6 md:px-10">
          <div className="flex items-center gap-2 mb-2">
            <div className="p-2 bg-white/15 backdrop-blur-sm rounded-full border border-white/10">
              <Plane className="h-4 w-4 md:h-5 md:w-5 text-white" />
            </div>
            <div className="p-2 bg-white/15 backdrop-blur-sm rounded-full border border-white/10">
              <Package className="h-3.5 w-3.5 md:h-4 md:w-4 text-white/90" />
            </div>
          </div>
          
          <h2 className="text-xl md:text-3xl font-bold text-white drop-shadow-lg">
            {shop.deliveryIn2To4Weeks || "Delivery in 2-4 Weeks"}
          </h2>
          
          <p className="text-white/90 mt-1.5 md:mt-2 max-w-md text-xs md:text-base drop-shadow">
            {shop.deliverySubtext || "From the USA, straight to your door in DRC"}
          </p>
        </div>
      </motion.div>
    </div>
  );
}
