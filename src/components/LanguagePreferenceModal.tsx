import { useState, useEffect } from 'react';
import { languages, Language } from '@/lib/i18n/translations';
import { useLanguage } from '@/contexts/LanguageContext';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Globe } from 'lucide-react';

const LANGUAGE_PREFERENCE_KEY = 'afrishop_language_set';

export function LanguagePreferenceModal() {
  const { language, setLanguage } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(language);

  useEffect(() => {
    const hasSetLanguage = localStorage.getItem(LANGUAGE_PREFERENCE_KEY);
    if (!hasSetLanguage) {
      setIsOpen(true);
    }
  }, []);

  const handleConfirm = () => {
    setLanguage(selectedLanguage);
    localStorage.setItem(LANGUAGE_PREFERENCE_KEY, 'true');
    setIsOpen(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => {}}>
      <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Globe className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-xl">Choose Your Language</DialogTitle>
          <DialogDescription>
            Select your preferred language for the AfriShop Admin Portal
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={selectedLanguage}
          onValueChange={(value) => setSelectedLanguage(value as Language)}
          className="mt-4 space-y-3"
        >
          {languages.map((lang) => (
            <div
              key={lang.code}
              className={`flex items-center space-x-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                selectedLanguage === lang.code
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:bg-muted/50'
              }`}
              onClick={() => setSelectedLanguage(lang.code)}
            >
              <RadioGroupItem value={lang.code} id={lang.code} />
              <Label
                htmlFor={lang.code}
                className="flex flex-1 items-center gap-3 cursor-pointer"
              >
                <span className="text-2xl">{lang.flag}</span>
                <span className="font-medium">{lang.name}</span>
              </Label>
            </div>
          ))}
        </RadioGroup>

        <Button onClick={handleConfirm} className="mt-6 w-full" size="lg">
          Continue
        </Button>
      </DialogContent>
    </Dialog>
  );
}
