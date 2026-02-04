import { motion } from 'framer-motion';
import { Plane, Package } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';
import deliveryBannerImg from '@/assets/delivery-hero-banner.png';

export function DeliveryHeroBanner() {
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = t.shop as Record<string, string>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="relative overflow-hidden rounded-2xl mx-4 h-48 md:h-56"
    >
      {/* Background Image */}
      <img 
        src={deliveryBannerImg}
        alt="Fast delivery - airplane with packages"
        className="absolute inset-0 w-full h-full object-cover"
      />
      
      {/* Dark overlay for text readability */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/40 to-transparent" />
      
      {/* Content Overlay */}
      <div className="relative z-10 h-full flex flex-col justify-center px-6 md:px-10">
        <div className="flex items-center gap-2 mb-2">
          <div className="p-2 bg-white/20 backdrop-blur-sm rounded-full">
            <Plane className="h-5 w-5 text-white" />
          </div>
          <div className="p-2 bg-white/20 backdrop-blur-sm rounded-full">
            <Package className="h-4 w-4 text-white/90" />
          </div>
        </div>
        
        <h2 className="text-2xl md:text-3xl font-bold text-white drop-shadow-lg">
          {shop.deliveryIn2To4Weeks || "Delivery in 2-4 Weeks"}
        </h2>
        
        <p className="text-white/90 mt-2 max-w-md text-sm md:text-base drop-shadow">
          {shop.deliverySubtext || "From the USA, straight to your door in DRC"}
        </p>
      </div>
    </motion.div>
  );
}
