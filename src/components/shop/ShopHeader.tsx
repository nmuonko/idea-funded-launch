import { Link, useLocation } from 'react-router-dom';
import { LogIn, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchBar } from './SearchBar';
import { CartDrawer } from './CartDrawer';
import { useAuth } from '@/contexts/AuthContext';
import afrishopLogo from '@/assets/afrishop-logo.png';

export function ShopHeader() {
  const location = useLocation();
  const { user } = useAuth();
  const isSearchPage = location.pathname === '/shop/search';

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-xl border-b border-white/10">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center gap-4">
          {/* Logo */}
          <Link to="/shop" className="flex-shrink-0">
            <img src={afrishopLogo} alt="AfriShop" className="h-8 md:h-10" />
          </Link>

          {/* Search Bar - Hidden on search page (has its own) */}
          {!isSearchPage && (
            <div className="hidden md:block flex-1 max-w-xl">
              <SearchBar />
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1 md:hidden" />

          {/* Actions */}
          <div className="flex items-center gap-2">
            <CartDrawer />
            
            {user ? (
              <Link to="/profile">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white/70 hover:text-white hover:bg-white/10 rounded-full"
                >
                  <User className="h-5 w-5" />
                </Button>
              </Link>
            ) : (
              <Link to="/auth">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white/70 hover:text-white hover:bg-white/10 rounded-full"
                >
                  <LogIn className="h-5 w-5 mr-2" />
                  <span className="hidden sm:inline">Sign In</span>
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Mobile Search */}
        {!isSearchPage && (
          <div className="md:hidden mt-3">
            <SearchBar />
          </div>
        )}
      </div>
    </header>
  );
}
