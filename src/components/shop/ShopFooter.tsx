import { Link } from 'react-router-dom';
import { Globe, ChevronDown, Building2, FileText, MapPin, Mail, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { languages, translations } from '@/lib/i18n/translations';
import afrishopLogo from '@/assets/afrishop-logo.png';
import { SUPPORT_WHATSAPP_E164 } from '@/lib/supportConfig';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ShopFooter() {
  const { language, setLanguage } = useLanguage();
  const t = translations[language] || translations.en;
  const shop = t.shop as Record<string, string>;
  const common = t.common as Record<string, string>;
  const currentLanguage = languages.find(l => l.code === language) || languages[0];
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-black border-t border-white/10 pb-24 md:pb-0">
      <div className="container mx-auto px-4 py-12">
        {/* Main Footer Content */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10 mb-12">
          {/* Company Info */}
          <div className="sm:col-span-2 lg:col-span-1 space-y-4">
            <img src={afrishopLogo} alt="AfriShop" className="h-8" />
            <ul className="space-y-4 text-sm">
              <li className="flex items-start gap-3 text-white/60">
                <Building2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{shop.operatedBy || 'Operated by'} <strong className="text-white">AMERICAN GOODWILL SARL</strong></span>
              </li>
              <li className="flex items-start gap-3 text-white/60">
                <FileText className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>RCCM: CD/LSH/RCCM/17-B-6093 | ID Nat: 05-F4300-N05127D</span>
              </li>
              <li className="flex items-start gap-3 text-white/60">
                <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>114 Croisement Av. Ndjamena & Kasaï, Q. Makutano, Lubumbashi, Haut-Katanga, RDC</span>
              </li>
              <li className="flex items-center gap-3 text-white/60">
                <Mail className="h-4 w-4 flex-shrink-0" />
                <a href="mailto:nkadimisha@afrishop-usa.com" className="hover:text-white transition-colors">
                  nkadimisha@afrishop-usa.com
                </a>
              </li>
            </ul>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-white font-semibold mb-4">{shop.quickLinks || 'Quick Links'}</h3>
            <ul className="space-y-2.5">
              <li>
                <Link to="/browse" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.shopFooterTitle || 'Shop'}
                </Link>
              </li>
              <li>
                <Link to="/how-it-works" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.howItWorks || 'How It Works'}
                </Link>
              </li>
              <li>
                <Link to="/about" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.about || 'About'}
                </Link>
              </li>
              <li>
                <Link to="/coverage" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.coverage || 'Coverage'}
                </Link>
              </li>
              <li>
                <Link to="/payouts" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.payouts || 'Payouts'}
                </Link>
              </li>
              <li>
                <Link to="/track-order" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.trackOrder || 'Track Order'}
                </Link>
              </li>
              <li>
                <Link to="/download" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.downloadApp || 'Download App'}
                </Link>
              </li>
            </ul>
          </div>

          {/* Contact Us */}
          <div>
            <h3 className="text-white font-semibold mb-4">{shop.contactUs || 'Contact Us'}</h3>
            <div className="flex flex-col gap-4">
              {/* Icon buttons */}
              <div className="flex items-center gap-3">
                <a
                  href={`https://wa.me/${SUPPORT_WHATSAPP_E164.replace(/[^0-9]/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-11 h-11 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 hover:bg-emerald-500/30 hover:text-emerald-300 transition-colors"
                  title="WhatsApp"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                </a>
                <a
                  href="mailto:nkadimisha@afrishop-usa.com"
                  className="w-11 h-11 rounded-full bg-sky-500/20 flex items-center justify-center text-sky-400 hover:bg-sky-500/30 hover:text-sky-300 transition-colors"
                  title="Email"
                >
                  <Mail className="h-5 w-5" />
                </a>
              </div>
              {/* Chat in App */}
              <Link to="/support">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full border-white/20 text-white/80 hover:bg-white/10 hover:text-white gap-2"
                >
                  <MessageCircle className="h-4 w-4" />
                  {shop.chatInApp || 'Chat in App'}
                </Button>
              </Link>
            </div>
          </div>

          {/* Legal Links */}
          <div>
            <h3 className="text-white font-semibold mb-4">{shop.legalFooterTitle || 'Legal'}</h3>
            <ul className="space-y-2.5">
              <li>
                <Link to="/terms" className="text-white/60 hover:text-white text-sm transition-colors">
                  {common.terms || 'Terms'}
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="text-white/60 hover:text-white text-sm transition-colors">
                  {common.privacy || 'Privacy'}
                </Link>
              </li>
              <li>
                <Link to="/refunds" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.refunds || 'Refunds'}
                </Link>
              </li>
              <li>
                <Link to="/payouts-beneficiaries" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.payoutsBeneficiaries || 'Payouts & Beneficiaries'}
                </Link>
              </li>
              <li>
                <Link to="/payments-compliance" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.payments || 'Payments'}
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-8 border-t border-white/10">
          <p className="text-white/40 text-sm">
            © {currentYear} AfriShop. {shop.allRightsReserved || 'All rights reserved.'}
          </p>

          <div className="flex items-center gap-4">
            <p className="text-white/40 text-sm">
              {shop.aBrandOf || 'A brand of'} <span className="text-white/60">AMERICAN GOODWILL SARL</span>
            </p>

            {/* Language Selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white/60 hover:text-white hover:bg-white/10 rounded-full gap-2"
                >
                  <Globe className="h-4 w-4" />
                  <span>{currentLanguage.flag}</span>
                  <span className="hidden sm:inline">{currentLanguage.name}</span>
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-black/95 border-white/10 backdrop-blur-xl">
                {languages.map((lang) => (
                  <DropdownMenuItem
                    key={lang.code}
                    onClick={() => setLanguage(lang.code)}
                    className={`text-white/80 hover:text-white hover:bg-white/10 cursor-pointer ${
                      language === lang.code ? 'bg-blue-500/20 text-blue-400' : ''
                    }`}
                  >
                    <span className="mr-2">{lang.flag}</span>
                    {lang.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </footer>
  );
}
