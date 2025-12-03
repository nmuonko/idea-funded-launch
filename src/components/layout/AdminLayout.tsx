import { useState, useMemo } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { getAdminTranslation } from '@/lib/i18n/translations';
import { LanguageSwitcher } from '@/components/layout/LanguageSwitcher';
import { useAdminPermissions } from '@/hooks/useAdminPermissions';
import { useAdminTheme } from '@/contexts/AdminThemeContext';
import { 
  LayoutDashboard, Users, LogOut, ArrowLeft, CreditCard, Settings, 
  Truck, BarChart, Wallet, MessageSquare, BarChart3, BookOpen, 
  ShoppingCart, TestTube, Menu, X, ChevronLeft, ChevronRight, Bookmark,
  Palette
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { language } = useLanguage();
  const { permissions, loading: permissionsLoading } = useAdminPermissions();
  const { backgroundColor } = useAdminTheme();
  const t = getAdminTranslation(language);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Define nav items with permission requirements
  const allNavItems = useMemo(() => [
    { to: '/admin', icon: LayoutDashboard, label: t.sidebar.dashboard, exact: true, permission: null }, // Always visible
    { to: '/admin/orders', icon: CreditCard, label: t.sidebar.orders, permission: 'canAccessOrders' as const },
    { to: '/admin/carts', icon: ShoppingCart, label: t.sidebar.activeCarts, permission: 'canAccessCarts' as const },
    { to: '/admin/saved-carts', icon: Bookmark, label: 'Saved Carts', permission: 'canAccessCarts' as const },
    { to: '/admin/ab-tests', icon: TestTube, label: t.sidebar.abTestResults, permission: 'canAccessAnalytics' as const },
    { to: '/admin/payments', icon: Wallet, label: t.sidebar.payments, permission: 'canAccessPayments' as const },
    { to: '/admin/shipping', icon: Truck, label: t.sidebar.shipping, permission: 'canAccessShipping' as const },
    { to: '/admin/shipping-types', icon: Truck, label: 'Shipping Types', permission: 'canAccessShipping' as const },
    { to: '/admin/support', icon: MessageSquare, label: t.sidebar.supportTickets, permission: 'canAccessSupport' as const },
    { to: '/admin/ticket-analytics', icon: BarChart3, label: t.sidebar.ticketAnalytics, permission: 'canAccessSupport' as const },
    { to: '/admin/knowledge-base', icon: BookOpen, label: t.sidebar.knowledgeBase, permission: 'canAccessKnowledgeBase' as const },
    { to: '/admin/analytics', icon: BarChart, label: t.sidebar.analytics, permission: 'canAccessAnalytics' as const },
    { to: '/admin/users', icon: Users, label: t.sidebar.userManagement, permission: 'canAccessUsers' as const },
    { to: '/admin/settings', icon: Settings, label: t.sidebar.settings, permission: 'canAccessSettings' as const },
    { to: '/admin/theme-settings', icon: Palette, label: 'Theme Settings', permission: 'isSuperAdmin' as const },
  ], [t]);

  // Filter nav items based on permissions
  const navItems = useMemo(() => {
    if (!permissions) return allNavItems.filter(item => item.permission === null);
    return allNavItems.filter(item => 
      item.permission === null || permissions[item.permission]
    );
  }, [allNavItems, permissions]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const toggleSidebar = () => setIsCollapsed(!isCollapsed);
  const toggleMobile = () => setIsMobileOpen(!isMobileOpen);

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className={cn(
        "flex items-center gap-2 p-4 border-b border-border/50",
        isCollapsed ? "justify-center" : "justify-between"
      )}>
        {!isCollapsed && (
          <div>
            <h2 className="text-xl font-bold text-primary">
              {t.sidebar.adminPanel}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">AfriShop</p>
          </div>
        )}
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={toggleSidebar}
          className="hidden lg:flex h-8 w-8"
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </Button>
      </div>

      {/* Role Badge */}
      {!isCollapsed && permissions && (
        <div className="px-4 py-2 border-b border-border/50">
          <span className="text-xs font-medium px-2 py-1 rounded-full bg-primary/10 text-primary capitalize">
            {permissions.role.replace('_', ' ')}
          </span>
        </div>
      )}

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="space-y-1">
          {permissionsLoading ? (
            // Loading skeleton
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className={cn("h-10 w-full", isCollapsed ? "w-10" : "")} />
            ))
          ) : (
            navItems.map((item) => {
              const isActive = item.exact 
                ? location.pathname === item.to
                : location.pathname.startsWith(item.to);
              
              return (
                <Link 
                  key={item.to} 
                  to={item.to}
                  onClick={() => setIsMobileOpen(false)}
                >
                  <Button
                    variant={isActive ? 'default' : 'ghost'}
                    className={cn(
                      'w-full transition-all duration-200',
                      isCollapsed ? 'justify-center px-2' : 'justify-start gap-3',
                      isActive && 'shadow-glow'
                    )}
                    title={isCollapsed ? item.label : undefined}
                  >
                    <item.icon className="h-5 w-5 flex-shrink-0" />
                    {!isCollapsed && <span className="truncate">{item.label}</span>}
                  </Button>
                </Link>
              );
            })
          )}
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div className={cn(
        "border-t border-border/50 p-3 space-y-2",
        isCollapsed && "px-2"
      )}>
        <Button 
          variant="outline" 
          className={cn(
            "w-full transition-all duration-200",
            isCollapsed ? "justify-center px-2" : "justify-start gap-3"
          )} 
          asChild
          title={isCollapsed ? t.sidebar.backToSite : undefined}
        >
          <Link to="/">
            <ArrowLeft className="h-5 w-5 flex-shrink-0" />
            {!isCollapsed && <span>{t.sidebar.backToSite}</span>}
          </Link>
        </Button>
        <Button 
          variant="outline" 
          className={cn(
            "w-full transition-all duration-200",
            isCollapsed ? "justify-center px-2" : "justify-start gap-3"
          )}
          onClick={handleSignOut}
          title={isCollapsed ? t.sidebar.signOut : undefined}
        >
          <LogOut className="h-5 w-5 flex-shrink-0" />
          {!isCollapsed && <span>{t.sidebar.signOut}</span>}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile Header */}
      <div className="fixed top-0 left-0 right-0 z-50 lg:hidden bg-card border-b border-border/50 px-4 py-3 flex items-center justify-between">
        <Button variant="ghost" size="icon" onClick={toggleMobile}>
          {isMobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
        <h2 className="text-lg font-bold text-primary">
          {t.sidebar.adminPanel}
        </h2>
        <LanguageSwitcher />
      </div>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar - Desktop */}
      <aside className={cn(
        "hidden lg:flex flex-col bg-card border-r border-border/50 transition-all duration-300",
        isCollapsed ? "w-16" : "w-64"
      )}>
        <SidebarContent />
      </aside>

      {/* Sidebar - Mobile */}
      <aside className={cn(
        "fixed top-14 left-0 bottom-0 z-50 w-64 bg-card border-r border-border/50 transition-transform duration-300 lg:hidden",
        isMobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <SidebarContent />
      </aside>

      {/* Main content */}
      <main className="flex-1 lg:pt-0 pt-14">
        {/* Desktop Language Switcher */}
        <div className="hidden lg:flex justify-end p-4 pb-0">
          <LanguageSwitcher />
        </div>
        <div 
          className="p-4 md:p-8 pt-2 min-h-screen transition-colors duration-300"
          style={{ backgroundColor }}
        >
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
