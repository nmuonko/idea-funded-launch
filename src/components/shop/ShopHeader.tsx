import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LogIn, User, Menu, Globe, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchBar } from './SearchBar';
import { CartDrawer } from './CartDrawer';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { languages, translations } from '@/lib/i18n/translations';
import afrishopLogo from '@/assets/afrishop-logo.png';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
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
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedPrice, setSelectedPrice] = useState('any');

  const t = translations[language] || translations.en;
  const shop = t.shop;
  const currentLanguage = languages.find(l => l.code === language) || languages[0];

  const filterCategories = [
    { label: shop.allCategories, value: 'all' },
    { label: shop.electronics, value: 'electronics' },
    { label: shop.vehicles, value: 'vehicles' },
    { label: shop.clothingFashion, value: 'clothing' },
    { label: shop.homeGarden, value: 'home' },
    { label: shop.toysGames, value: 'toys' },
    { label: shop.sportsOutdoors, value: 'sports' },
    { label: shop.jewelryWatches, value: 'jewelry' },
  ];

  const priceRanges = [
    { label: shop.anyPrice, value: 'any' },
    { label: shop.under50, value: '0-50' },
    { label: shop.price50to200, value: '50-200' },
    { label: shop.price200to500, value: '200-500' },
    { label: shop.price500to1000, value: '500-1000' },
    { label: shop.over1000, value: '1000+' },
  ];

  const handleCategoryClick = (value: string) => {
    setSelectedCategory(value);
    setMobileMenuOpen(false);
    if (value !== 'all') {
      navigate(`/shop/search?category=${value}`);
    } else {
      navigate('/shop');
    }
  };

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-xl border-b border-white/10">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center gap-2 md:gap-3">
          {/* Left Side: Menu + Logo */}
          
          {/* Hamburger Menu */}
          <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-white/70 hover:text-white hover:bg-white/10 rounded-full p-2"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 bg-black/95 border-white/10 p-0">
              <SheetHeader className="p-4 border-b border-white/10">
                <SheetTitle className="text-white flex items-center gap-2">
                  <SlidersHorizontal className="h-5 w-5" />
                  {shop.filtersAndMenu}
                </SheetTitle>
              </SheetHeader>
              
              <div className="p-4 space-y-6">
                {/* Categories */}
                <div>
                  <h3 className="text-sm font-medium text-white/60 mb-3 uppercase tracking-wider">{shop.category}</h3>
                  <div className="space-y-1">
                    {filterCategories.map((cat) => (
                      <button
                        key={cat.value}
                        onClick={() => handleCategoryClick(cat.value)}
                        className={cn(
                          "w-full text-left px-3 py-2 rounded-lg transition-colors",
                          selectedCategory === cat.value
                            ? "bg-gradient-to-r from-blue-500/20 to-cyan-500/20 text-white border border-blue-500/30"
                            : "text-white/70 hover:bg-white/5 hover:text-white"
                        )}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Price Range */}
                <div>
                  <h3 className="text-sm font-medium text-white/60 mb-3 uppercase tracking-wider">{shop.priceRange}</h3>
                  <div className="space-y-1">
                    {priceRanges.map((range) => (
                      <button
                        key={range.value}
                        onClick={() => setSelectedPrice(range.value)}
                        className={cn(
                          "w-full text-left px-3 py-2 rounded-lg transition-colors",
                          selectedPrice === range.value
                            ? "bg-gradient-to-r from-blue-500/20 to-cyan-500/20 text-white border border-blue-500/30"
                            : "text-white/70 hover:bg-white/5 hover:text-white"
                        )}
                      >
                        {range.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Quick Links */}
                <div className="pt-4 border-t border-white/10">
                  <h3 className="text-sm font-medium text-white/60 mb-3 uppercase tracking-wider">{shop.quickLinks}</h3>
                  <div className="space-y-1">
                    <Link
                      to="/shop"
                      onClick={() => setMobileMenuOpen(false)}
                      className="block px-3 py-2 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition-colors"
                    >
                      {shop.homeLink}
                    </Link>
                    <Link
                      to="/orders"
                      onClick={() => setMobileMenuOpen(false)}
                      className="block px-3 py-2 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition-colors"
                    >
                      {shop.myOrders}
                    </Link>
                    <Link
                      to="/support"
                      onClick={() => setMobileMenuOpen(false)}
                      className="block px-3 py-2 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition-colors"
                    >
                      {shop.support}
                    </Link>
                  </div>
                </div>
              </div>
            </SheetContent>
          </Sheet>

          {/* Logo */}
          <Link to="/shop" className="flex-shrink-0">
            <img src={afrishopLogo} alt="AfriShop" className="h-8" />
          </Link>

          {/* Search Bar - CENTER: Takes most space */}
          <div className="flex-1 mx-2 md:mx-4">
            <SearchBar className="w-full" />
          </div>

          {/* Right Side: Language + Cart + Account */}
          <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
            {/* Language Selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white/70 hover:text-white hover:bg-white/10 rounded-full gap-1 px-2"
                >
                  <Globe className="h-4 w-4" />
                  <span className="text-sm">{currentLanguage.flag}</span>
                  <ChevronDown className="h-3 w-3 hidden sm:block" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-black/95 border-white/10 backdrop-blur-xl">
                <DropdownMenuLabel className="text-white/60">{shop.selectLanguage}</DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-white/10" />
                {languages.map((lang) => (
                  <DropdownMenuItem
                    key={lang.code}
                    onClick={() => setLanguage(lang.code)}
                    className={cn(
                      "text-white/80 hover:text-white hover:bg-white/10 cursor-pointer",
                      language === lang.code && "bg-blue-500/20 text-blue-400"
                    )}
                  >
                    <span className="mr-2">{lang.flag}</span>
                    {lang.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Cart */}
            <CartDrawer />
            
            {/* Auth */}
            {user ? (
              <Link to="/profile">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white/70 hover:text-white hover:bg-white/10 rounded-full p-2"
                >
                  <User className="h-5 w-5" />
                </Button>
              </Link>
            ) : (
              <Link to="/auth">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white/70 hover:text-white hover:bg-white/10 rounded-full p-2"
                >
                  <LogIn className="h-5 w-5" />
                  <span className="hidden sm:inline ml-1 text-sm">{shop.signIn}</span>
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
