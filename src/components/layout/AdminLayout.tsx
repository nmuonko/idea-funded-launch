import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { LayoutDashboard, Users, FileText, Mail, LogOut, ArrowLeft, CreditCard, BarChart, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();

  const navItems = [
    { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', exact: true },
    { to: '/admin/sessions', icon: Users, label: 'Sessions' },
    { to: '/admin/submissions', icon: FileText, label: 'Submissions' },
    { to: '/admin/analytics', icon: BarChart, label: 'Analytics' },
    { to: '/admin/session-settings', icon: Settings, label: 'Session Settings' },
    { to: '/admin/contacts', icon: Mail, label: 'Contact Messages' },
    { to: '/admin/payment-settings', icon: CreditCard, label: 'Payment Settings' },
  ];

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="w-64 glass-strong border-r border-border/50 p-6 space-y-8">
        <div>
          <h2 className="text-2xl font-bold bg-gradient-glow bg-clip-text text-transparent">
            Admin Panel
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Project Competition</p>
        </div>

        <nav className="space-y-2">
          {navItems.map((item) => {
            const isActive = item.exact 
              ? location.pathname === item.to
              : location.pathname.startsWith(item.to);
            
            return (
              <Link key={item.to} to={item.to}>
                <Button
                  variant={isActive ? 'default' : 'ghost'}
                  className={cn(
                    'w-full justify-start gap-3 transition-smooth',
                    isActive && 'shadow-glow'
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  {item.label}
                </Button>
              </Link>
            );
          })}
        </nav>

        <div className="pt-4 border-t border-border/50 space-y-2">
          <Button variant="outline" className="w-full justify-start gap-3" asChild>
            <Link to="/">
              <ArrowLeft className="h-5 w-5" />
              Back to Site
            </Link>
          </Button>
          <Button 
            variant="outline" 
            className="w-full justify-start gap-3"
            onClick={handleSignOut}
          >
            <LogOut className="h-5 w-5" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 p-8 bg-gradient-subtle">
        <div className="max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
