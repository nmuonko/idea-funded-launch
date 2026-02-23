import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Bell } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AdminNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
  payload: Record<string, unknown>;
}

export function AdminNotificationsBell() {
  const { language } = useLanguage();
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<AdminNotification | null>(null);
  const isFr = language === 'fr';

  const load = async () => {
    const { data } = await supabase
      .from('admin_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);

    if (data) {
      setNotifications(data as AdminNotification[]);
      setUnreadCount(data.filter(n => !n.read_at).length);
    }
  };

  useEffect(() => { load(); }, []);

  const markAllRead = async () => {
    const unreadIds = notifications.filter(n => !n.read_at).map(n => n.id);
    if (unreadIds.length === 0) return;
    await supabase
      .from('admin_notifications')
      .update({ read_at: new Date().toISOString() })
      .in('id', unreadIds);
    load();
  };

  const markOneRead = async (id: string) => {
    await supabase
      .from('admin_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', id);
    load();
  };

  const handleClick = (n: AdminNotification) => {
    setSelected(n);
    setOpen(false);
    if (!n.read_at) markOneRead(n.id);
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon" className="relative h-9 w-9">
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="flex items-center justify-between p-3 border-b">
            <span className="font-semibold text-sm">
              {isFr ? 'Notifications' : 'Notifications'}
            </span>
            {unreadCount > 0 && (
              <Button variant="ghost" size="sm" className="text-xs h-7" onClick={markAllRead}>
                {isFr ? 'Tout marquer lu' : 'Mark all read'}
              </Button>
            )}
          </div>
          <ScrollArea className="h-80">
            {notifications.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-6">
                {isFr ? 'Aucune notification' : 'No notifications'}
              </p>
            ) : (
              notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={cn(
                    'px-3 py-2 border-b last:border-b-0 text-sm cursor-pointer hover:bg-accent/50 transition-colors',
                    !n.read_at && 'bg-accent/30'
                  )}
                >
                  <p className="font-medium">{n.title}</p>
                  <p className="text-muted-foreground text-xs mt-0.5 line-clamp-2">{n.body}</p>
                  <p className="text-muted-foreground text-[10px] mt-1">
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                </div>
              ))
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>

      <Dialog open={!!selected} onOpenChange={(v) => !v && setSelected(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{selected?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm whitespace-pre-wrap">{selected?.body}</p>
            <p className="text-xs text-muted-foreground">
              {selected && new Date(selected.created_at).toLocaleString()}
            </p>
            {selected?.payload && Object.keys(selected.payload).length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  {isFr ? 'Détails' : 'Details'}
                </summary>
                <pre className="mt-2 p-2 rounded bg-muted text-xs overflow-auto max-h-40">
                  {JSON.stringify(selected.payload, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
