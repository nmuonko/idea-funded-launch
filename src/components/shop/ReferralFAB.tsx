import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Gift } from 'lucide-react';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';
import { InviteEarn } from '@/components/shop/InviteEarn';
import { useLanguage } from '@/contexts/LanguageContext';

export function ReferralFAB() {
  const location = useLocation();
  const { language } = useLanguage();
  const [open, setOpen] = useState(false);

  // Hide on account page where InviteEarn is already shown inline
  if (location.pathname.startsWith('/account')) return null;

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <button
          className="fixed bottom-20 md:bottom-8 left-4 md:left-8 z-50 h-12 w-12 rounded-full bg-gradient-to-br from-orange-500 to-pink-500 shadow-lg flex items-center justify-center text-white animate-pulse hover:scale-110 transition-transform"
          aria-label="Partager & Gagner"
        >
          <Gift className="h-5 w-5" />
        </button>
      </DrawerTrigger>
      <DrawerContent className="bg-black border-white/10 px-4 pb-8 pt-4 max-h-[85vh] overflow-y-auto">
        <InviteEarn language={language} />
      </DrawerContent>
    </Drawer>
  );
}
