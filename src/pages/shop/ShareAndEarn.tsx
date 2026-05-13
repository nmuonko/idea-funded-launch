import { useLanguage } from '@/contexts/LanguageContext';
import { InviteEarn } from '@/components/shop/InviteEarn';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { SEOHead } from '@/components/SEOHead';

export default function ShareAndEarn() {
  const { language } = useLanguage();

  return (
    <>
      <SEOHead title="Share & Earn" description="Invite friends to AfriShop and earn mobile-money commissions on every order they place." />
    <div className="min-h-screen bg-background">
      <ShopHeader />
      <main className="max-w-xl mx-auto px-4 py-8 pb-24">
        <InviteEarn language={language} />
      </main>
    </div>
    </>
  );
}
