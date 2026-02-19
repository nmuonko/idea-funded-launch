import { Shield, Truck, Headphones, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

const badges = [
  {
    icon: Shield,
    labelEn: 'Secure Payment',
    labelFr: 'Paiement Sécurisé',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  {
    icon: Truck,
    labelEn: 'USA → DRC Delivery',
    labelFr: 'Livraison USA-RDC',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
  },
  {
    icon: Headphones,
    labelEn: 'Support 24/7',
    labelFr: 'Support 24/7',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/10',
  },
  {
    icon: RefreshCw,
    labelEn: 'Money-Back',
    labelFr: 'Remboursement',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
  },
];

export function TrustBadgesStrip() {
  const { language } = useLanguage();

  return (
    <div className="container mx-auto px-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {badges.map((badge, i) => {
          const Icon = badge.icon;
          return (
            <div
              key={i}
              className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
            >
              <div className={`flex-shrink-0 h-8 w-8 rounded-lg ${badge.bg} flex items-center justify-center`}>
                <Icon className={`h-4 w-4 ${badge.color}`} />
              </div>
              <span className="text-white/80 text-xs font-medium leading-tight">
                {language === 'fr' ? badge.labelFr : badge.labelEn}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
