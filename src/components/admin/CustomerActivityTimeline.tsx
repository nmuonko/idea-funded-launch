import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Eye,
  Search,
  ShoppingCart,
  CreditCard,
  Package,
  AlertCircle,
  Activity,
  MousePointerClick,
  XCircle,
} from 'lucide-react';

interface Props {
  userId: string;
}

type EventKind =
  | 'view'
  | 'search'
  | 'funnel'
  | 'funnel_error'
  | 'audit'
  | 'click'
  | 'order';

interface TimelineEvent {
  id: string;
  kind: EventKind;
  timestamp: string;
  title: string;
  description?: string;
  badge?: string;
  badgeVariant?: 'default' | 'secondary' | 'destructive' | 'outline';
}

const ICONS: Record<EventKind, React.ReactNode> = {
  view: <Eye className="h-3.5 w-3.5" />,
  search: <Search className="h-3.5 w-3.5" />,
  funnel: <ShoppingCart className="h-3.5 w-3.5" />,
  funnel_error: <XCircle className="h-3.5 w-3.5" />,
  audit: <Activity className="h-3.5 w-3.5" />,
  click: <MousePointerClick className="h-3.5 w-3.5" />,
  order: <Package className="h-3.5 w-3.5" />,
};

const COLORS: Record<EventKind, string> = {
  view: 'bg-blue-500',
  search: 'bg-cyan-500',
  funnel: 'bg-amber-500',
  funnel_error: 'bg-red-500',
  audit: 'bg-purple-500',
  click: 'bg-pink-500',
  order: 'bg-emerald-500',
};

export function CustomerActivityTimeline({ userId }: Props) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastStep, setLastStep] = useState<string | null>(null);

  useEffect(() => {
    if (userId) load();
  }, [userId]);

  const load = async () => {
    setLoading(true);
    try {
      const [funnel, audit, viewed, clicks, orders] = await Promise.all([
        supabase
          .from('checkout_funnel_log')
          .select('id, step, status, error_message, created_at, order_id')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('system_audit_log')
          .select('id, event_type, error_message, created_at, order_id, payload')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50),
        supabase
          .from('recently_viewed_items')
          .select('id, title, product_url, store_id, last_viewed_at, view_count')
          .eq('user_id', userId)
          .order('last_viewed_at', { ascending: false })
          .limit(30),
        supabase
          .from('hot_product_clicks')
          .select('id, provider_product_id, provider, event_type, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('orders')
          .select('id, status, total_usd, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      const merged: TimelineEvent[] = [];

      (funnel.data || []).forEach((row: any) => {
        const isError = row.status !== 'ok' || row.error_message;
        merged.push({
          id: `f-${row.id}`,
          kind: isError ? 'funnel_error' : 'funnel',
          timestamp: row.created_at,
          title: `Checkout: ${row.step.replace(/_/g, ' ')}`,
          description: row.error_message || (row.order_id ? `Order ${row.order_id.slice(0, 8)}` : undefined),
          badge: row.status,
          badgeVariant: isError ? 'destructive' : 'secondary',
        });
      });

      (audit.data || []).forEach((row: any) => {
        merged.push({
          id: `a-${row.id}`,
          kind: 'audit',
          timestamp: row.created_at,
          title: row.event_type.replace(/_/g, ' '),
          description: row.error_message || undefined,
        });
      });

      (viewed.data || []).forEach((row: any) => {
        merged.push({
          id: `v-${row.id}`,
          kind: 'view',
          timestamp: row.last_viewed_at,
          title: `Viewed: ${row.title || row.product_url}`,
          description: `${row.store_id} • ${row.view_count}× views`,
        });
      });

      (clicks.data || []).forEach((row: any) => {
        merged.push({
          id: `c-${row.id}`,
          kind: 'click',
          timestamp: row.created_at,
          title: `${row.event_type} on hot product`,
          description: `${row.provider} • ${row.provider_product_id}`,
        });
      });

      (orders.data || []).forEach((row: any) => {
        merged.push({
          id: `o-${row.id}`,
          kind: 'order',
          timestamp: row.created_at,
          title: `Order placed #${row.id.slice(0, 8).toUpperCase()}`,
          description: `$${(row.total_usd || 0).toFixed(2)}`,
          badge: row.status,
          badgeVariant: 'outline',
        });
      });

      merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      // Compute last funnel step for the "stopped at" summary
      const latestFunnel = (funnel.data || [])[0];
      setLastStep(latestFunnel ? `${latestFunnel.step} (${latestFunnel.status})` : null);

      setEvents(merged.slice(0, 200));
    } catch (e) {
      console.error('Activity timeline load error', e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <AlertCircle className="h-10 w-10 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No activity recorded for this user yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {lastStep && (
        <div className="bg-muted/50 rounded-lg p-3 text-sm">
          <span className="text-muted-foreground">Last checkout step: </span>
          <span className="font-medium">{lastStep}</span>
        </div>
      )}

      <div className="relative">
        <div className="absolute left-[11px] top-0 bottom-0 w-0.5 bg-border" />
        <div className="space-y-4">
          {events.map((event) => (
            <div key={event.id} className="relative flex gap-3">
              <div
                className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${COLORS[event.kind]} text-white`}
              >
                {ICONS[event.kind]}
              </div>
              <div className="flex-1 min-w-0 pb-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{event.title}</p>
                    {event.description && (
                      <p className="text-xs text-muted-foreground truncate">
                        {event.description}
                      </p>
                    )}
                    {event.badge && (
                      <Badge variant={event.badgeVariant || 'outline'} className="text-[10px] mt-1">
                        {event.badge}
                      </Badge>
                    )}
                  </div>
                  <span
                    className="text-[11px] text-muted-foreground whitespace-nowrap"
                    title={format(new Date(event.timestamp), 'MMM d, yyyy HH:mm:ss')}
                  >
                    {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
