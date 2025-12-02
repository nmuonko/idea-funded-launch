import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { 
  LayoutDashboard, Users, LogOut, ArrowLeft, CreditCard, Settings, 
  Truck, BarChart, Wallet, MessageSquare, BarChart3, BookOpen, 
  ShoppingCart, TestTube, Menu, X, ChevronLeft, ChevronRight 
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  const navItems = [
    { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', exact: true },
    { to: '/admin/orders', icon: CreditCard, label: 'Orders' },
    { to: '/admin/carts', icon: ShoppingCart, label: 'Active Carts' },
    { to: '/admin/ab-tests', icon: TestTube, label: 'A/B Test Results' },
    { to: '/admin/payments', icon: Wallet, label: 'Payments' },
    { to: '/admin/shipping', icon: Truck, label: 'Shipping' },
    { to: '/admin/support', icon: MessageSquare, label: 'Support Tickets' },
    { to: '/admin/ticket-analytics', icon: BarChart3, label: 'Ticket Analytics' },
    { to: '/admin/knowledge-base', icon: BookOpen, label: 'Knowledge Base' },
    { to: '/admin/analytics', icon: BarChart, label: 'Analytics' },
    { to: '/admin/users', icon: Users, label: 'User Management' },
    { to: '/admin/settings', icon: Settings, label: 'Settings' },
  ];

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
              Admin Panel
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

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="space-y-1">
          {navItems.map((item) => {
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
          })}
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
          title={isCollapsed ? "Back to Site" : undefined}
        >
          <Link to="/">
            <ArrowLeft className="h-5 w-5 flex-shrink-0" />
            {!isCollapsed && <span>Back to Site</span>}
          </Link>
        </Button>
        <Button 
          variant="outline" 
          className={cn(
            "w-full transition-all duration-200",
            isCollapsed ? "justify-center px-2" : "justify-start gap-3"
          )}
          onClick={handleSignOut}
          title={isCollapsed ? "Sign Out" : undefined}
        >
          <LogOut className="h-5 w-5 flex-shrink-0" />
          {!isCollapsed && <span>Sign Out</span>}
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
          Admin Panel
        </h2>
        <div className="w-10" /> {/* Spacer for centering */}
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
        <div className="p-4 md:p-8 bg-background min-h-screen">
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
