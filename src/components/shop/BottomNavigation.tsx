import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, ShoppingCart, Heart, Package, User } from 'lucide-react';
import { useShopCart } from '@/contexts/ShopCartContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { translations } from '@/lib/i18n/translations';
import { cn } from '@/lib/utils';


const tabs = [
  { key: 'browse', icon: Home, path: '/' },
  { key: 'cart', icon: ShoppingCart, path: '/cart' },
  { key: 'saved', icon: Heart, path: '/saved' },
  { key: 'orders', icon: Package, path: '/my-orders' },
  { key: 'account', icon: User, path: '/account' },
] as const;

export function BottomNavigation() {
  const location = useLocation();
  const navigate = useNavigate();
  const { itemCount, savedItems } = useShopCart();
  const { language } = useLanguage();
  const t = translations[language] || translations.en;

  const getLabel = (key: string) => {
    // Cast shop to any to avoid TS errors while translation types sync
    const shopT = t.shop as any;
    const labels: Record<string, string> = {
      browse: shopT?.browseTab || 'Browse',
      cart: shopT?.cart || 'Cart',
      saved: shopT?.savedTab || 'Saved',
      orders: shopT?.ordersTab || 'Orders',
      account: shopT?.accountTab || 'Account',
    };
    return labels[key] || key;
  };

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/' || location.pathname.startsWith('/search') || location.pathname.startsWith('/product');
    }
    return location.pathname.startsWith(path);
  };

  return (
    <>
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-black/95 backdrop-blur-lg border-t border-white/10 md:hidden pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center justify-around h-16 px-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.path);
          const showBadge = (tab.key === 'cart' && itemCount > 0) || (tab.key === 'saved' && savedItems.length > 0);
          const badgeCount = tab.key === 'cart' ? itemCount : savedItems.length;

          return (
            <Link
              key={tab.key}
              to={tab.path}
              onClick={(e) => {
                // Prevent re-navigation when already on this path to avoid remount + empty state
                if (isActive(tab.path) && tab.path === '/') {
                  e.preventDefault();
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }
              }}
              className={cn(
                "flex flex-col items-center justify-center flex-1 min-h-[44px] min-w-[44px] py-2 transition-colors",
                active ? "text-blue-500" : "text-white/60 hover:text-white/80"
              )}
            >
              <div className="relative">
                <Icon className={cn("h-6 w-6", active && "scale-110")} />
                {showBadge && (
                  <span className="absolute -top-1 -right-2 bg-blue-500 text-white text-[10px] font-bold rounded-full h-4 min-w-[16px] flex items-center justify-center px-1">
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </div>
              <span className={cn(
                "text-[10px] mt-1 font-medium",
                active && "text-blue-500"
              )}>
                {getLabel(tab.key)}
              </span>
            </Link>
          );
        })}
      </div>
      {/* Safe area handled by pb-[env(safe-area-inset-bottom)] on nav */}
    </nav>
    </>
  );
}
