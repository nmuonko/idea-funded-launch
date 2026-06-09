import { ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LucideIcon } from 'lucide-react';
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useAdminPermissions, AdminPermissions } from '@/hooks/useAdminPermissions';

export type AdminHubTab = {
  to: string;
  label: string;
  icon: LucideIcon;
  permission: keyof AdminPermissions;
};

interface AdminHubLayoutProps {
  title: string;
  tabs: AdminHubTab[];
  children?: ReactNode;
}

export function AdminHubLayout({ title, tabs }: AdminHubLayoutProps) {
  const { permissions } = useAdminPermissions();
  const { pathname } = useLocation();

  const visibleTabs = tabs.filter((t) =>
    permissions ? Boolean(permissions[t.permission]) : false
  );

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border/50 bg-background/60 sticky top-0 z-10 backdrop-blur supports-[backdrop-filter]:bg-background/40">
        <div className="px-4 pt-4 pb-2">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        </div>
        <ScrollArea className="w-full">
          <nav className="flex items-center gap-1 px-4 pb-2 min-w-max">
            {visibleTabs.map((tab) => {
              const isActive =
                pathname === tab.to || pathname.startsWith(tab.to + '/');
              const Icon = tab.icon;
              return (
                <NavLink
                  key={tab.to}
                  to={tab.to}
                  className={cn(
                    'inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
                    'hover:bg-muted',
                    isActive
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{tab.label}</span>
                </NavLink>
              );
            })}
          </nav>
          <ScrollBar orientation="horizontal" />
        </ScrollArea>
      </div>
      <div className="flex-1">
        <Outlet />
      </div>
    </div>
  );
}
