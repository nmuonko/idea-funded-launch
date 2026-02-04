import { Truck, Clock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

interface DeliveryEstimateProps {
  minDays?: number;
  maxDays?: number;
  className?: string;
}

export function DeliveryEstimate({ minDays = 10, maxDays = 17, className }: DeliveryEstimateProps) {
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = t.shop as Record<string, string>;

  // Calculate estimated delivery dates
  const today = new Date();
  const minDate = new Date(today);
  minDate.setDate(today.getDate() + minDays);
  const maxDate = new Date(today);
  maxDate.setDate(today.getDate() + maxDays);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className={`bg-white/5 border border-white/10 rounded-xl p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0">
          <Truck className="h-5 w-5 text-green-400" />
        </div>
        <div>
          <h4 className="text-white font-medium">
            {shop.estimatedDelivery || 'Estimated Delivery'}
          </h4>
          <p className="text-white/80 text-sm mt-0.5">
            {formatDate(minDate)} - {formatDate(maxDate)}, {maxDate.getFullYear()}
          </p>
          <div className="flex items-center gap-1 text-white/50 text-xs mt-1">
            <Clock className="h-3 w-3" />
            <span>
              {shop.businessDays || `${minDays}-${maxDays} business days`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
