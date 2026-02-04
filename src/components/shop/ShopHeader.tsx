import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { LogIn, User, Menu, X, Globe, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchBar } from './SearchBar';
import { CartDrawer } from './CartDrawer';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { languages } from '@/lib/i18n/translations';
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

const filterCategories = [
  { label: 'All Categories', value: 'all' },
  { label: 'Electronics', value: 'electronics' },
  { label: 'Vehicles', value: 'vehicles' },
  { label: 'Clothing & Fashion', value: 'clothing' },
  { label: 'Home & Garden', value: 'home' },
  { label: 'Toys & Games', value: 'toys' },
  { label: 'Sports & Outdoors', value: 'sports' },
  { label: 'Jewelry & Watches', value: 'jewelry' },
];

const priceRanges = [
  { label: 'Any Price', value: 'any' },
  { label: 'Under $50', value: '0-50' },
  { label: '$50 - $200', value: '50-200' },
  { label: '$200 - $500', value: '200-500' },
  { label: '$500 - $1000', value: '500-1000' },
  { label: 'Over $1000', value: '1000+' },
];

export function ShopHeader() {
  const location = useLocation();
  const { user } = useAuth();
  const { language, setLanguage } = useLanguage();
  const isSearchPage = location.pathname === '/shop/search';
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedPrice, setSelectedPrice] = useState('any');

  const currentLanguage = languages.find(l => l.code === language) || languages[0];

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-black/90 backdrop-blur-xl border-b border-white/10">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Hamburger Menu - Left */}
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
                  Filters & Menu
                </SheetTitle>
              </SheetHeader>
              
              <div className="p-4 space-y-6">
                {/* Categories */}
                <div>
                  <h3 className="text-sm font-medium text-white/60 mb-3 uppercase tracking-wider">Category</h3>
                  <div className="space-y-1">
                    {filterCategories.map((cat) => (
                      <button
                        key={cat.value}
                        onClick={() => {
                          setSelectedCategory(cat.value);
                          if (cat.value !== 'all') {
                            window.location.href = `/shop/search?category=${cat.value}`;
                          }
                        }}
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
                  <h3 className="text-sm font-medium text-white/60 mb-3 uppercase tracking-wider">Price Range</h3>
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
                  <h3 className="text-sm font-medium text-white/60 mb-3 uppercase tracking-wider">Quick Links</h3>
                  <div className="space-y-1">
                    <Link
                      to="/shop"
                      onClick={() => setMobileMenuOpen(false)}
                      className="block px-3 py-2 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition-colors"
                    >
                      Home
                    </Link>
                    <Link
                      to="/orders"
                      onClick={() => setMobileMenuOpen(false)}
                      className="block px-3 py-2 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition-colors"
                    >
                      My Orders
                    </Link>
                    <Link
                      to="/support"
                      onClick={() => setMobileMenuOpen(false)}
                      className="block px-3 py-2 rounded-lg text-white/70 hover:bg-white/5 hover:text-white transition-colors"
                    >
                      Support
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

          {/* Search Bar - Prominent, always visible */}
          <div className="flex-1 max-w-2xl">
            <SearchBar className="w-full" />
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-1 md:gap-2">
            {/* Language Selector */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white/70 hover:text-white hover:bg-white/10 rounded-full gap-1 px-2 md:px-3"
                >
                  <Globe className="h-4 w-4" />
                  <span className="hidden md:inline text-sm">{currentLanguage.flag}</span>
                  <ChevronDown className="h-3 w-3 hidden md:block" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-black/95 border-white/10 backdrop-blur-xl">
                <DropdownMenuLabel className="text-white/60">Select Language</DropdownMenuLabel>
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
                  className="text-white/70 hover:text-white hover:bg-white/10 rounded-full p-2 md:px-3"
                >
                  <LogIn className="h-5 w-5" />
                  <span className="hidden md:inline ml-2">Sign In</span>
                </Button>
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}