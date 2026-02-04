import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';

interface MobileMoneyProvider {
  id: string;
  name: string;
  color: string;
  icon: string;
}

const providers: MobileMoneyProvider[] = [
  { id: 'orange', name: 'Orange Money', color: '#FF6600', icon: '🟠' },
  { id: 'airtel', name: 'Airtel Money', color: '#ED1C24', icon: '🔴' },
  { id: 'mpesa', name: 'M-Pesa', color: '#4CAF50', icon: '🟢' },
  { id: 'vodacom', name: 'Vodacom M-Pesa', color: '#E60000', icon: '🔵' },
];

interface MobileMoneySelectorProps {
  selectedProvider: string | null;
  onSelectProvider: (providerId: string) => void;
}

export function MobileMoneySelector({ selectedProvider, onSelectProvider }: MobileMoneySelectorProps) {
  const { language } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = t.shop as Record<string, string>;

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-white/70">
        {shop.selectMobileProvider || 'Select Mobile Money Provider'}
      </h3>
      
      <RadioGroup value={selectedProvider || ''} onValueChange={onSelectProvider}>
        <div className="space-y-2">
          {providers.map((provider) => (
            <label
              key={provider.id}
              className={`flex items-center gap-4 p-4 rounded-xl border cursor-pointer transition-all ${
                selectedProvider === provider.id
                  ? 'border-blue-500/50 bg-blue-500/10'
                  : 'border-white/10 hover:bg-white/5'
              }`}
            >
              <RadioGroupItem 
                value={provider.id} 
                id={provider.id} 
                className="border-white/40" 
              />
              <span className="text-xl">{provider.icon}</span>
              <div className="flex-1">
                <p className="text-white font-medium">{provider.name}</p>
              </div>
            </label>
          ))}
        </div>
      </RadioGroup>

      <p className="text-sm text-white/50 text-center mt-4">
        {shop.mobileMoneyHint || "You'll receive a push notification to confirm on your phone."}
      </p>
    </div>
  );
}
