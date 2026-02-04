import { ShoppingBag, CreditCard, Package, Truck } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

const steps = [
  {
    icon: ShoppingBag,
    titleKey: 'howItWorks1Title',
    descKey: 'howItWorks1Desc',
    defaultTitle: 'Browse & Add',
    defaultDesc: 'Find products from US stores and add them to your cart.',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
  },
  {
    icon: CreditCard,
    titleKey: 'howItWorks2Title',
    descKey: 'howItWorks2Desc',
    defaultTitle: 'Checkout',
    defaultDesc: 'Pay securely with card, mobile money, or bank transfer.',
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
  },
  {
    icon: Package,
    titleKey: 'howItWorks3Title',
    descKey: 'howItWorks3Desc',
    defaultTitle: 'We Purchase',
    defaultDesc: 'We buy the items from US stores on your behalf.',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/20',
  },
  {
    icon: Truck,
    titleKey: 'howItWorks4Title',
    descKey: 'howItWorks4Desc',
    defaultTitle: 'Delivery to DRC',
    defaultDesc: 'Items shipped to Kinshasa or Lubumbashi (10-17 days).',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/20',
  },
];

interface HowItWorksProps {
  variant?: 'vertical' | 'horizontal';
  className?: string;
}

export function HowItWorks({ variant = 'vertical', className }: HowItWorksProps) {
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = t.shop as Record<string, string>;

  if (variant === 'horizontal') {
    return (
      <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 ${className}`}>
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <div key={index} className="text-center">
              <div className={`w-12 h-12 ${step.bgColor} rounded-full flex items-center justify-center mx-auto mb-3`}>
                <Icon className={`h-6 w-6 ${step.color}`} />
              </div>
              <h4 className="text-white font-medium text-sm mb-1">
                {shop[step.titleKey] || step.defaultTitle}
              </h4>
              <p className="text-white/50 text-xs">
                {shop[step.descKey] || step.defaultDesc}
              </p>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {steps.map((step, index) => {
        const Icon = step.icon;
        return (
          <div key={index} className="flex gap-4">
            <div className="flex flex-col items-center">
              <div className={`w-12 h-12 ${step.bgColor} rounded-full flex items-center justify-center`}>
                <Icon className={`h-6 w-6 ${step.color}`} />
              </div>
              {index < steps.length - 1 && (
                <div className="w-0.5 flex-1 bg-white/10 my-2" />
              )}
            </div>
            <div className="flex-1 pb-6">
              <h4 className="text-white font-semibold mb-1">
                Step {index + 1}: {shop[step.titleKey] || step.defaultTitle}
              </h4>
              <p className="text-white/60 text-sm">
                {shop[step.descKey] || step.defaultDesc}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
