import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ShoppingBag, CreditCard, Truck, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';
import afrishopLogo from '@/assets/afrishop-logo.png';

const ONBOARDING_KEY = 'afrishop_onboarding_complete';

interface OnboardingStep {
  icon: React.ReactNode;
  titleKey: string;
  descriptionKey: string;
  defaultTitle: string;
  defaultDescription: string;
}

const steps: OnboardingStep[] = [
  {
    icon: <ShoppingBag className="h-16 w-16 text-blue-400" />,
    titleKey: 'onboardingStep1Title',
    descriptionKey: 'onboardingStep1Desc',
    defaultTitle: 'Shop Top US Stores',
    defaultDescription: 'Browse thousands of products from Amazon, eBay, and top US retailers',
  },
  {
    icon: <CreditCard className="h-16 w-16 text-green-400" />,
    titleKey: 'onboardingStep2Title',
    descriptionKey: 'onboardingStep2Desc',
    defaultTitle: 'Easy Checkout',
    defaultDescription: 'Pay with Mobile Money, Card, or Bank Transfer - whatever works for you',
  },
  {
    icon: <Truck className="h-16 w-16 text-orange-400" />,
    titleKey: 'onboardingStep3Title',
    descriptionKey: 'onboardingStep3Desc',
    defaultTitle: 'Fast Delivery to DRC',
    defaultDescription: 'We handle everything - shipping right to your door in Kinshasa and beyond',
  },
];

export default function Onboarding() {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const [currentStep, setCurrentStep] = useState(0);

  const t = translations[language] || translations.en;
  const shop = t.shop as Record<string, string>;

  // Check if already completed
  useEffect(() => {
    const completed = localStorage.getItem(ONBOARDING_KEY);
    if (completed === 'true') {
      navigate('/browse', { replace: true });
    }
  }, [navigate]);

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      handleComplete();
    }
  };

  const handleSkip = () => {
    handleComplete();
  };

  const handleComplete = () => {
    localStorage.setItem(ONBOARDING_KEY, 'true');
    navigate('/browse', { replace: true });
  };

  const step = steps[currentStep];
  const isLastStep = currentStep === steps.length - 1;

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <header className="p-4 flex items-center justify-between">
        <img src={afrishopLogo} alt="AfriShop" className="h-8 brightness-0 invert" />
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSkip}
          className="text-white/60 hover:text-white hover:bg-white/10"
        >
          {shop.skip || 'Skip'}
        </Button>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            transition={{ duration: 0.3 }}
            className="w-full max-w-sm text-center space-y-8"
          >
            {/* Icon */}
            <div className="w-32 h-32 bg-white/5 rounded-full flex items-center justify-center mx-auto border border-white/10">
              {step.icon}
            </div>

            {/* Content */}
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-white">
                {(shop as any)[step.titleKey] || step.defaultTitle}
              </h2>
              <p className="text-white/60 text-base leading-relaxed">
                {(shop as any)[step.descriptionKey] || step.defaultDescription}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Dots Indicator */}
        <div className="flex items-center gap-2 mt-12">
          {steps.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentStep(index)}
              className={`w-2 h-2 rounded-full transition-all ${
                index === currentStep
                  ? 'w-8 bg-blue-500'
                  : 'bg-white/20 hover:bg-white/40'
              }`}
            />
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="p-6">
        <Button
          onClick={handleNext}
          className="w-full h-14 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white rounded-full text-lg"
        >
          {isLastStep ? (shop.startShopping || 'Start Shopping') : (shop.next || 'Next')}
          <ChevronRight className="h-5 w-5 ml-2" />
        </Button>
      </footer>
    </div>
  );
}
