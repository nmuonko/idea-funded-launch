import { Link } from 'react-router-dom';
import { Mail, MessageCircle } from 'lucide-react';
 import { useSupportChat } from '@/contexts/SupportChatContext';
 import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';
 import { SUPPORT_WHATSAPP_E164 } from '@/lib/supportConfig';
 
 // WhatsApp icon component
 function WhatsAppIcon({ className }: { className?: string }) {
   return (
     <svg viewBox="0 0 24 24" className={className} fill="currentColor">
       <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
     </svg>
   );
 }
 
 export function ShopFooter() {
  const { language } = useLanguage();
   const t = translations[language] || translations.en;
   const shop = t.shop as Record<string, string>;
   const common = t.common as Record<string, string>;
   const currentYear = new Date().getFullYear();
   const { openChat } = useSupportChat();
 
   return (
     <footer className="bg-black border-t border-white/10 pb-24 md:pb-0">
       <div className="container mx-auto px-4 py-12">
         {/* Main Footer Content - 4 columns on desktop, 2 on tablet, 1 on mobile */}
         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-12 gap-y-10 mb-10">
           
           {/* Column A: AfriShop */}
           <div>
             <h3 className="text-white font-semibold text-base mb-5">AfriShop</h3>
             <ul className="space-y-3">
               <li>
                 <Link to="/" className="text-white/60 hover:text-white text-sm transition-colors">
                   {shop.shopFooterTitle || 'Boutique'}
                 </Link>
               </li>
               <li>
                 <Link to="/how-it-works" className="text-white/60 hover:text-white text-sm transition-colors">
                   {shop.howItWorks || 'Comment ça marche'}
                 </Link>
               </li>
               <li>
                 <Link to="/about" className="text-white/60 hover:text-white text-sm transition-colors">
                   {shop.about || 'À propos'}
                 </Link>
               </li>
               <li>
                 <Link to="/coverage" className="text-white/60 hover:text-white text-sm transition-colors">
                   {shop.coverage || 'Couverture'}
                 </Link>
               </li>
               <li>
                 <Link to="/track-order" className="text-white/60 hover:text-white text-sm transition-colors">
                   {shop.trackOrder || 'Suivre commande'}
                 </Link>
               </li>
               <li>
                 <Link to="/download" className="text-white/60 hover:text-white text-sm transition-colors">
                   {shop.downloadApp || 'Télécharger l\'app'}
                 </Link>
               </li>
             </ul>
           </div>
 
           {/* Column B: Aide (Help) */}
           <div>
             <h3 className="text-white font-semibold text-base mb-5">{shop.help || 'Aide'}</h3>
             <ul className="space-y-3">
               <li>
                 <button 
                   onClick={openChat}
                   className="text-white/60 hover:text-white text-sm transition-colors text-left"
                 >
                   Support
                 </button>
               </li>
               <li>
                 <Link to="/refunds" className="text-white/60 hover:text-white text-sm transition-colors">
                   {shop.refunds || 'Remboursements'}
                 </Link>
               </li>
               <li>
                 <Link to="/payments-compliance" className="text-white/60 hover:text-white text-sm transition-colors">
                   {shop.payments || 'Paiements'}
                 </Link>
               </li>
               <li>
                 <Link to="/payouts-beneficiaries" className="text-white/60 hover:text-white text-sm transition-colors">
                   {shop.payoutsBeneficiaries || 'Payouts & Beneficiaries'}
                 </Link>
               </li>
             </ul>
           </div>
 
           {/* Column C: Entreprise (Company) */}
           <div>
             <h3 className="text-white font-semibold text-base mb-5">{shop.company || 'Entreprise'}</h3>
             <div className="space-y-3 text-sm text-white/60">
               <p>
                 {shop.operatedBy || 'Operated by'}{' '}
                 <span className="text-white/80 font-medium">AMERICAN GOODWILL SARL</span>
               </p>
               <p className="text-xs leading-relaxed">
                 RCCM: CD/LSH/RCCM/17-B-6093
                 <br />
                 ID Nat: 05-F4300-N05127D
               </p>
               <p className="text-xs leading-relaxed">
                 114 Croisement Av. Ndjamena & Kasaï,
                 <br />
                 Q. Makutano, Lubumbashi,
                 <br />
                 Haut-Katanga, RDC
               </p>
             </div>
           </div>
 
           {/* Column D: Légal (Legal) */}
           <div>
             <h3 className="text-white font-semibold text-base mb-5">{shop.legalFooterTitle || 'Légal'}</h3>
             <ul className="space-y-3">
               <li>
                 <Link to="/terms" className="text-white/60 hover:text-white text-sm transition-colors">
                   {common.terms || 'Conditions'}
                 </Link>
               </li>
               <li>
                 <Link to="/privacy" className="text-white/60 hover:text-white text-sm transition-colors">
                   {common.privacy || 'Confidentialité'}
                 </Link>
               </li>
               <li>
                 <Link to="/refunds" className="text-white/60 hover:text-white text-sm transition-colors">
                   {shop.refundPolicy || 'Politique de remboursement'}
                 </Link>
               </li>
             </ul>
           </div>
         </div>
 
         {/* Contact Row - Compact inline links */}
         <div className="flex flex-wrap items-center justify-center gap-6 py-6 border-t border-white/10">
           <a
             href={`https://wa.me/${SUPPORT_WHATSAPP_E164.replace(/[^0-9]/g, '')}`}
             target="_blank"
             rel="noopener noreferrer"
             className="flex items-center gap-2 text-white/70 hover:text-white text-sm transition-colors group"
           >
             <WhatsAppIcon className="h-4 w-4 text-emerald-500 group-hover:text-emerald-400" />
             <span>WhatsApp</span>
           </a>
           <span className="text-white/20">•</span>
           <a
             href="mailto:nkadimisha@afrishop-usa.com"
             className="flex items-center gap-2 text-white/70 hover:text-white text-sm transition-colors group"
           >
             <Mail className="h-4 w-4 text-sky-500 group-hover:text-sky-400" />
             <span>Email</span>
           </a>
           <span className="text-white/20">•</span>
           <button
             onClick={openChat}
             className="flex items-center gap-2 text-white/70 hover:text-white text-sm transition-colors group"
           >
             <MessageCircle className="h-4 w-4 text-primary group-hover:text-primary/80" />
             <span>Chat</span>
           </button>
         </div>
 
         {/* Bottom Bar */}
         <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-6 border-t border-white/10">
           <p className="text-white/40 text-sm">
             © {currentYear} AfriShop. {shop.allRightsReserved || 'Tous droits réservés.'}
           </p>
 
          <p className="text-white/40 text-sm">
            {shop.aBrandOf || 'A brand of'} <span className="text-white/60">AMERICAN GOODWILL SARL</span>
          </p>
         </div>
       </div>
     </footer>
   );
 }
