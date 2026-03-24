import { useLanguage } from '@/contexts/LanguageContext';
import { InviteEarn } from '@/components/shop/InviteEarn';
import { ShopHeader } from '@/components/shop/ShopHeader';
import { Helmet } from 'react-helmet-async';

export default function ShareAndEarn() {
  const { language } = useLanguage();

  const meta = {
    fr: {
      title: 'Partagez & Gagnez | AfriShop USA',
      description: 'Partagez votre lien unique AfriShop et gagnez une commission sur chaque achat. Revenus versés directement sur votre Mobile Money.',
    },
    en: {
      title: 'Share & Earn | AfriShop USA',
      description: 'Share your unique AfriShop link and earn a commission on every purchase. Earnings paid directly to your Mobile Money wallet.',
    },
  };

  const m = (meta as any)[language] || meta.fr;

  return (
    <>
      <Helmet>
        <title>{m.title}</title>
        <meta name="description" content={m.description} />
        <meta property="og:title" content={m.title} />
        <meta property="og:description" content={m.description} />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://afrishop-usa.com/share" />
      </Helmet>
      <div className="min-h-screen bg-background">
        <ShopHeader />
        <main className="max-w-xl mx-auto px-4 py-8">
          <InviteEarn language={language} />
        </main>
      </div>
    </>
  );
}
