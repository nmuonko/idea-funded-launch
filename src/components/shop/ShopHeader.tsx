import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LogIn, User, Menu, Globe, ChevronDown, Home, Package, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchBar } from './SearchBar';
import { CartDrawer } from './CartDrawer';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { languages, translations } from '@/lib/i18n/translations';
import afrishopLogo from '@/assets/afrishop-logo.png';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export function ShopHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { language, setLanguage } = useLanguage();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const t = translations[language] || translations.en;
  const shop = t.shop;
  const currentLanguage = languages.find(l => l.code === language) || languages[0];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-xl border-b border-white/10">
      <div className="container mx-auto px-3 md:px-4 py-2 md:py-3">
        <div className="flex items-center gap-2 md:gap-3">
          {/* Logo - Far Left */}
          <Link to="/browse" className="flex-shrink-0">
            <img src={afrishopLogo} alt="AfriShop" className="h-8" />
          </Link>

          {/* Search Bar - Takes most space */}
          <div className="flex-1 mx-1 md:mx-4">
            <SearchBar className="w-full" />
          </div>

          {/* Right Side: Cart + Hamburger */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <CartDrawer />

            {/* Hamburger Menu - Far Right */}
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white/70 hover:text-white hover:bg-white/10 rounded-full min-h-[44px] min-w-[44px] p-2"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-72 bg-black/95 border-white/10 p-0">
                <SheetHeader className="p-4 border-b border-white/10">
                  <SheetTitle className="text-white flex items-center gap-2">
                    <img src={afrishopLogo} alt="AfriShop" className="h-6" />
                  </SheetTitle>
                </SheetHeader>
                
                <div className="p-4 space-y-6">
                  {/* Account */}
                  <div>
                    <h3 className="text-sm font-medium text-white/60 mb-3 uppercase tracking-wider">
                      {shop.accountTab || 'Account'}
                    </h3>
                    <div className="space-y-1">
                      {user ? (
                        <Link
                          to="/profile"
                          onClick={() => setMobileMenuOpen(false)}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition-colors"
                        >
                          <User className="h-4 w-4" />
                          {shop.accountTab || 'My Profile'}
                        </Link>
                      ) : (
                        <Link
                          to="/shop-auth"
                          onClick={() => setMobileMenuOpen(false)}
                          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition-colors"
                        >
                          <LogIn className="h-4 w-4" />
                          {shop.signIn}
                        </Link>
                      )}
                    </div>
                  </div>

                  {/* Language */}
                  <div>
                    <h3 className="text-sm font-medium text-white/60 mb-3 uppercase tracking-wider">
                      {shop.selectLanguage || 'Language'}
                    </h3>
                    <div className="space-y-1">
                      {languages.map((lang) => (
                        <button
                          key={lang.code}
                          onClick={() => {
                            setLanguage(lang.code);
                            setMobileMenuOpen(false);
                          }}
                          className={cn(
                            "w-full text-left px-3 py-2 rounded-lg transition-colors flex items-center gap-2",
                            language === lang.code
                              ? "bg-gradient-to-r from-blue-500/20 to-cyan-500/20 text-white border border-blue-500/30"
                              : "text-white/70 hover:bg-white/5 hover:text-white"
                          )}
                        >
                          <span>{lang.flag}</span>
                          {lang.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Quick Links */}
                  <div className="pt-4 border-t border-white/10">
                    <h3 className="text-sm font-medium text-white/60 mb-3 uppercase tracking-wider">{shop.quickLinks}</h3>
                    <div className="space-y-1">
                      <Link
                        to="/browse"
                        onClick={() => setMobileMenuOpen(false)}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition-colors"
                      >
                        <Home className="h-4 w-4" />
                        {shop.homeLink}
                      </Link>
                      <Link
                        to="/my-orders"
                        onClick={() => setMobileMenuOpen(false)}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition-colors"
                      >
                        <Package className="h-4 w-4" />
                        {shop.myOrders}
                      </Link>
                      <Link
                        to="/support"
                        onClick={() => setMobileMenuOpen(false)}
                        className="flex items-center gap-3 px-3 py-2 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition-colors"
                      >
                        <HelpCircle className="h-4 w-4" />
                        {shop.support}
                      </Link>
                    </div>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </header>
  );
}
