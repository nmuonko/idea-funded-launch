import { Link } from 'react-router-dom';
import { Globe, ChevronDown, Facebook, Instagram, Twitter } from 'lucide-react';
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
          {/* Brand */}
          <div className="col-span-2 md:col-span-1 space-y-4">
            <img src={afrishopLogo} alt="AfriShop" className="h-8" />
            <p className="text-white/60 text-sm">
              {shop.footerTagline || 'Shop USA, Deliver to Africa'}
            </p>
            {/* Social Links */}
            <div className="flex items-center gap-3">
              <a
                href="https://facebook.com/afrishop"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              >
                <Facebook className="h-5 w-5" />
              </a>
              <a
                href="https://instagram.com/afrishop"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              >
                <Instagram className="h-5 w-5" />
              </a>
              <a
                href="https://twitter.com/afrishop"
                target="_blank"
                rel="noopener noreferrer"
                className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              >
                <Twitter className="h-5 w-5" />
              </a>
            </div>
          </div>

          {/* Shop Links */}
          <div>
            <h3 className="text-white font-semibold mb-4">{shop.shopFooterTitle || 'Shop'}</h3>
            <ul className="space-y-3">
              <li>
                <Link to="/shop" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.homeLink || 'Home'}
                </Link>
              </li>
              <li>
                <Link to="/shop/search" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.allProducts || 'All Products'}
                </Link>
              </li>
              <li>
                <Link to="/shop/search?category=electronics" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.electronics || 'Electronics'}
                </Link>
              </li>
              <li>
                <Link to="/shop/search?category=clothing" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.clothingFashion || 'Clothing'}
                </Link>
              </li>
            </ul>
          </div>

          {/* Support Links */}
          <div>
            <h3 className="text-white font-semibold mb-4">{shop.supportFooterTitle || 'Support'}</h3>
            <ul className="space-y-3">
              <li>
                <Link to="/knowledge-base" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.helpCenter || 'Help Center'}
                </Link>
              </li>
              <li>
                <Link to="/contact" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.contactUs || 'Contact Us'}
                </Link>
              </li>
              <li>
                <Link to="/track-order" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.trackOrder || 'Track Order'}
                </Link>
              </li>
              <li>
                <a
                  href="https://wa.me/243973141627"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-white/60 hover:text-white text-sm transition-colors"
                >
                  WhatsApp
                </a>
              </li>
            </ul>
          </div>

          {/* Legal Links */}
          <div>
            <h3 className="text-white font-semibold mb-4">{shop.legalFooterTitle || 'Legal'}</h3>
            <ul className="space-y-3">
              <li>
                <Link to="/terms" className="text-white/60 hover:text-white text-sm transition-colors">
                  {common.terms || 'Terms of Service'}
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="text-white/60 hover:text-white text-sm transition-colors">
                  {common.privacy || 'Privacy Policy'}
                </Link>
              </li>
              <li>
                <Link to="/refunds" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.refundPolicy || 'Refund Policy'}
                </Link>
              </li>
              <li>
                <Link to="/payments-compliance" className="text-white/60 hover:text-white text-sm transition-colors">
                  {shop.paymentsCompliance || 'Payments'}
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
                <span>{currentLanguage.name}</span>
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
    </footer>
  );
}
