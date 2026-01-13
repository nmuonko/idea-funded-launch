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
  LayoutDashboard, Users, UserCircle, LogOut, ArrowLeft, CreditCard, Settings, 
  Truck, BarChart, Wallet, MessageSquare, BarChart3, BookOpen, 
  ShoppingCart, TestTube, Menu, X, ChevronLeft, ChevronRight, Bookmark,
  Palette, Shield, Car, Activity, Headphones, FileCheck, Building2, DollarSign, Globe,
  ChevronDown
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { language } = useLanguage();
  const { permissions, loading: permissionsLoading } = useAdminPermissions();
  const { theme } = useAdminTheme();
  const t = getAdminTranslation(language);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  const isSuperAdmin = permissions?.isSuperAdmin;

  // Define nav sections with grouped items
  const navSections = useMemo(() => [
    {
      title: language === 'fr' ? 'Opérations' : 'Operations',
      items: [
        { to: '/admin', icon: LayoutDashboard, label: t.sidebar.dashboard, exact: true, permission: 'can_view_dashboard' as const },
        { to: '/admin/orders', icon: CreditCard, label: t.sidebar.orders, permission: 'can_view_orders' as const },
        { to: '/admin/customers', icon: UserCircle, label: t.sidebar.customers || 'Customers', permission: 'can_view_customers' as const },
        { to: '/admin/shipping', icon: Truck, label: t.sidebar.shipping, permission: 'can_view_shipping' as const },
        { to: '/admin/carts', icon: ShoppingCart, label: language === 'fr' ? 'Paniers' : 'Carts', permission: 'can_view_active_carts' as const },
      ]
    },
    {
      title: language === 'fr' ? 'Finance' : 'Finance',
      items: [
        { to: '/admin/payments', icon: Wallet, label: t.sidebar.payments, permission: 'can_view_payments' as const },
        { to: '/admin/transfer-proofs', icon: FileCheck, label: t.sidebar.transferProofs || 'Transfer Proofs', permission: 'can_view_payments' as const },
        { to: '/admin/quote-requests', icon: Car, label: t.sidebar.quoteRequests || 'Vehicle Quotes', permission: 'can_view_orders' as const },
        { to: '/admin/price-confirmations', icon: DollarSign, label: language === 'fr' ? 'Prix à confirmer' : 'Price Reviews', permission: 'can_view_orders' as const },
      ]
    },
    {
      title: 'Support',
      items: [
        { to: '/admin/support-inbox', icon: Headphones, label: t.sidebar.supportInbox || 'Live Chat', permission: 'can_view_tickets' as const },
        { to: '/admin/ticket-analytics', icon: BarChart3, label: t.sidebar.ticketAnalytics, permission: 'can_view_ticket_analytics' as const },
      ]
    },
    {
      title: language === 'fr' ? 'Insights' : 'Insights',
      items: [
        { to: '/admin/analytics', icon: BarChart, label: t.sidebar.analytics, permission: 'can_view_analytics' as const },
        { to: '/admin/ab-tests', icon: TestTube, label: t.sidebar.abTestResults, permission: 'can_view_ab_results' as const },
      ]
    },
    {
      title: language === 'fr' ? 'Paramètres' : 'Settings',
      items: [
        { to: '/admin/settings', icon: Settings, label: language === 'fr' ? 'Frais & Marges' : 'Fees & Markup', permission: 'can_view_settings' as const },
        { to: '/admin/payments-settings', icon: CreditCard, label: language === 'fr' ? 'Paiements' : 'Payments', permission: 'can_view_payments' as const },
        { to: '/admin/bank-transfer-settings', icon: Building2, label: language === 'fr' ? 'Virement' : 'Bank Transfer', permission: 'can_view_settings' as const },
        { to: '/admin/service-zones', icon: Globe, label: language === 'fr' ? 'Zones' : 'Zones', permission: 'can_view_settings' as const },
        { to: '/admin/users', icon: Users, label: t.sidebar.staffManagement || 'Staff', permission: 'can_manage_users' as const },
        { to: '/admin/theme-settings', icon: Palette, label: language === 'fr' ? 'Thème' : 'Theme', permission: 'can_view_theme_settings' as const },
      ]
    },
    ...(isSuperAdmin ? [{
      title: language === 'fr' ? 'Système' : 'System',
      items: [
        { to: '/admin/health', icon: Activity, label: t.sidebar.health || 'Health', exact: false, permission: 'can_view_dashboard' as const },
        { to: '/admin/audit-log', icon: Shield, label: t.sidebar.auditLog, exact: false, permission: 'can_view_dashboard' as const },
      ]
    }] : []),
  ], [t, language, isSuperAdmin]);

  // Filter sections based on permissions
  const filteredSections = useMemo(() => {
    if (!permissions) return [];
    return navSections
      .map(section => ({
        ...section,
        items: section.items.filter(item => permissions[item.permission])
      }))
      .filter(section => section.items.length > 0);
  }, [navSections, permissions]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const toggleSidebar = () => setIsCollapsed(!isCollapsed);
  const toggleMobile = () => setIsMobileOpen(!isMobileOpen);
  const toggleSection = (title: string) => {
    setOpenSections(prev => ({ ...prev, [title]: !prev[title] }));
  };

  // Check if any item in a section is active
  const isSectionActive = (items: typeof filteredSections[0]['items']) => {
    return items.some(item => {
      const itemExact = 'exact' in item ? item.exact : false;
      return itemExact 
        ? location.pathname === item.to
        : location.pathname.startsWith(item.to);
    });
  };

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
        <nav className="space-y-4">
          {permissionsLoading ? (
            // Loading skeleton
            Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className={cn("h-10 w-full", isCollapsed ? "w-10" : "")} />
            ))
          ) : (
            filteredSections.map((section) => {
              const sectionActive = isSectionActive(section.items);
              const isOpen = openSections[section.title] ?? sectionActive;
              
              return isCollapsed ? (
                // Collapsed mode - show items directly with tooltips
                <div key={section.title} className="space-y-1">
                  {section.items.map((item) => {
                    const itemExact = 'exact' in item ? item.exact : false;
                    const isActive = itemExact 
                      ? location.pathname === item.to
                      : location.pathname.startsWith(item.to);
                    
                    return (
                      <Tooltip key={item.to}>
                        <TooltipTrigger asChild>
                          <Link to={item.to} onClick={() => setIsMobileOpen(false)}>
                            <Button
                              variant={isActive ? 'default' : 'ghost'}
                              className={cn(
                                'w-full justify-center px-2 transition-all duration-200',
                                isActive && 'shadow-glow'
                              )}
                            >
                              <item.icon className="h-5 w-5 flex-shrink-0" />
                            </Button>
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right">{item.label}</TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              ) : (
                // Expanded mode - collapsible sections
                <Collapsible
                  key={section.title}
                  open={isOpen}
                  onOpenChange={() => toggleSection(section.title)}
                  className="space-y-1"
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      className={cn(
                        "w-full justify-between px-2 text-muted-foreground hover:text-foreground",
                        sectionActive && "text-primary"
                      )}
                    >
                      <span className="text-xs font-semibold uppercase tracking-wider">
                        {section.title}
                      </span>
                      <ChevronDown 
                        className={cn(
                          "h-4 w-4 transition-transform duration-200",
                          isOpen && "rotate-180"
                        )} 
                      />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-1">
                    {section.items.map((item) => {
                      const itemExact = 'exact' in item ? item.exact : false;
                      const isActive = itemExact 
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
                              'w-full justify-start gap-3 pl-4 transition-all duration-200',
                              isActive && 'shadow-glow'
                            )}
                          >
                            <item.icon className="h-4 w-4 flex-shrink-0" />
                            <span className="truncate">{item.label}</span>
                          </Button>
                        </Link>
                      );
                    })}
                  </CollapsibleContent>
                </Collapsible>
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
    <div className="flex min-h-screen" style={{ backgroundColor: theme.backgroundColor }}>
      {/* Mobile Header */}
      <div 
        className="fixed top-0 left-0 right-0 z-50 lg:hidden border-b border-border/50 px-4 py-3 flex items-center justify-between"
        style={{ backgroundColor: theme.sidebarColor }}
      >
        <Button variant="ghost" size="icon" onClick={toggleMobile}>
          {isMobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
        <h2 className="text-lg font-bold text-primary">
          {t.sidebar.adminPanel}
        </h2>
        <div className="flex items-center gap-2">
          {isSuperAdmin && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={() => navigate('/admin/theme-settings')}
                  className="h-9 w-9"
                >
                  <Palette className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t.common.customizeTheme}</TooltipContent>
            </Tooltip>
          )}
          <LanguageSwitcher />
        </div>
      </div>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Sidebar - Desktop */}
      <aside 
        className={cn(
          "hidden lg:flex flex-col border-r border-border/50 transition-all duration-300",
          isCollapsed ? "w-16" : "w-64"
        )}
        style={{ backgroundColor: theme.sidebarColor }}
      >
        <SidebarContent />
      </aside>

      {/* Sidebar - Mobile */}
      <aside 
        className={cn(
          "fixed top-14 left-0 bottom-0 z-50 w-64 border-r border-border/50 transition-transform duration-300 lg:hidden",
          isMobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ backgroundColor: theme.sidebarColor }}
      >
        <SidebarContent />
      </aside>

      {/* Main content */}
      <main className="flex-1 lg:pt-0 pt-14">
        {/* Desktop Top Bar */}
        <div 
          className="hidden lg:flex justify-end items-center gap-3 p-4 pb-0"
          style={{ backgroundColor: theme.backgroundColor }}
        >
          {isSuperAdmin && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => navigate('/admin/theme-settings')}
                  className="gap-2 h-9"
                >
                  <Palette className="h-4 w-4" />
                  <span className="hidden xl:inline">Theme</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t.common.customizeTheme}</TooltipContent>
            </Tooltip>
          )}
          <LanguageSwitcher />
        </div>
        <div 
          className="p-4 md:p-8 pt-2 min-h-screen transition-colors duration-300"
          style={{ backgroundColor: theme.backgroundColor }}
        >
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
