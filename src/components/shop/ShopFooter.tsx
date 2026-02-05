import { Link } from 'react-router-dom';
import { Globe, ChevronDown, Building2, FileText, MapPin, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/contexts/LanguageContext';
import { languages, translations } from '@/lib/i18n/translations';
import afrishopLogo from '@/assets/afrishop-logo.png';
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
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          {/* Company Info */}
          <div className="col-span-2 space-y-4">
            <img src={afrishopLogo} alt="AfriShop" className="h-8" />
            <ul className="space-y-3 text-sm">
              <li className="flex items-start gap-2 text-white/60">
                <Building2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{shop.operatedBy || 'Operated by'} <strong className="text-white">AMERICAN GOODWILL SARL</strong></span>
              </li>
              <li className="flex items-start gap-2 text-white/60">
                <FileText className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>RCCM: CD/LSH/RCCM/17-B-6093 | ID Nat: 05-F4300-N05127D</span>
              </li>
              <li className="flex items-start gap-2 text-white/60">
                <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>114 Croisement Av. Ndjamena & Kasaï, Q. Makutano, Lubumbashi, Haut-Katanga, RDC</span>
              </li>
              <li className="flex items-center gap-2 text-white/60">
                <Mail className="h-4 w-4 flex-shrink-0" />
                <a href="mailto:support@afrishop-usa.com" className="hover:text-white transition-colors">
                  support@afrishop-usa.com
                </a>
              </li>
            </ul>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-white font-semibold mb-4">{shop.quickLinks || 'Quick Links'}</h3>
            <ul className="space-y-3">
              <li>
                <Link to="/shop" className="text-white/60 hover:text-white text-sm transition-colors">
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
                <Link to="/contact" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.contact || 'Contact'}
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

          {/* Legal Links */}
          <div>
            <h3 className="text-white font-semibold mb-4">{shop.legalFooterTitle || 'Legal'}</h3>
            <ul className="space-y-3">
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
