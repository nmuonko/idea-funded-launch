import { useState } from 'react';
import { languages, Language } from '@/lib/i18n/translations';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Globe, ChevronDown, Check } from 'lucide-react';

export function LanguageDropdown() {
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  
  const currentLang = languages.find(l => l.code === language);

  const handleSelect = (code: Language) => {
    setLanguage(code);
    setOpen(false);
  };

  return (
    <>
      <Button
        variant="outline"
        className="w-full justify-between"
        onClick={() => setOpen(true)}
      >
        <div className="flex items-center gap-2">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <span>{currentLang?.flag} {currentLang?.name}</span>
        </div>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[320px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Langue / Language
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            {languages.map((lang) => (
              <Button
                key={lang.code}
                variant={language === lang.code ? 'secondary' : 'ghost'}
                className="w-full justify-start gap-3"
                onClick={() => handleSelect(lang.code as Language)}
              >
                <span className="text-xl">{lang.flag}</span>
                <span className="flex-1 text-left">{lang.name}</span>
                {language === lang.code && (
                  <Check className="h-4 w-4 text-primary" />
                )}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
