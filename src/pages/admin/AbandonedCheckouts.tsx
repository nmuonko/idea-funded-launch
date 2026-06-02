import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Loader2, MessageCircle, RefreshCw, AlertTriangle } from 'lucide-react';

type FunnelRow = {
  id: string;
  user_id: string;
  order_id: string | null;
  step: string;
  status: string;
  error_message: string | null;
  metadata: any;
  created_at: string;
};

type Profile = {
  user_id: string;
  full_name: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
};

type OrderInfo = {
  id: string;
  user_id: string;
  status: string;
  total_usd: number;
  created_at: string;
};

type UserDrop = {
  user_id: string;
  profile?: Profile;
  lastStep: string;
  lastStatus: string;
  lastError: string | null;
  lastEventAt: string;
  orderId: string | null;
  orderTotal: number | null;
  orderStatus: string | null;
  eventsCount: number;
  reachedProvider: boolean;
};

const STEP_RANK: Record<string, number> = {
  order_created: 1,
  checkout_started: 2,
  provider_failed: 3,
  provider_exception: 3,
  checkout_failed: 3,
  provider_fallback: 4,
  payment_initiated: 5,
};

const STEP_LABEL: Record<string, string> = {
  order_created: 'Order created',
  checkout_started: 'Checkout started',
  provider_failed: 'Provider failed',
  provider_exception: 'Provider crashed',
  checkout_failed: 'Checkout failed',
  provider_fallback: 'Provider fallback (no pay link)',
  payment_initiated: 'Sent to payment provider',
};

const WINDOWS = [
  { label: '24h', hours: 24 },
  { label: '7d', hours: 24 * 7 },
  { label: '30d', hours: 24 * 30 },
];

export default function AbandonedCheckouts() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<FunnelRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [orders, setOrders] = useState<Record<string, OrderInfo>>({});
  const [windowHours, setWindowHours] = useState(24 * 7);

  const load = async () => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();
      const { data: funnel, error } = await supabase
        .from('checkout_funnel_log')
        .select('*')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(2000);
      if (error) throw error;
      const list = (funnel || []) as FunnelRow[];
      setRows(list);

      const userIds = Array.from(new Set(list.map((r) => r.user_id).filter(Boolean)));
      const orderIds = Array.from(
        new Set(
          list
            .map((r) => r.order_id || (r.metadata && r.metadata.orderId) || null)
            .filter(Boolean) as string[],
        ),
      );

      if (userIds.length) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('user_id, full_name, name, email, phone, country')
          .in('user_id', userIds);
        const pmap: Record<string, Profile> = {};
        (profs || []).forEach((p: any) => (pmap[p.user_id] = p));
        setProfiles(pmap);
      }
      if (orderIds.length) {
        const { data: ords } = await supabase
          .from('orders')
          .select('id, user_id, status, total_usd, created_at')
          .in('id', orderIds);
        const omap: Record<string, OrderInfo> = {};
        (ords || []).forEach((o: any) => (omap[o.id] = o));
        setOrders(omap);
      }
    } catch (e) {
      console.error('[AbandonedCheckouts] load failed', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [windowHours]);

  // Aggregate per user: pick most recent event, surface last error
  const drops = useMemo<UserDrop[]>(() => {
    const byUser: Record<string, FunnelRow[]> = {};
    rows.forEach((r) => {
      if (!byUser[r.user_id]) byUser[r.user_id] = [];
      byUser[r.user_id].push(r);
    });
    const out: UserDrop[] = [];
    for (const uid of Object.keys(byUser)) {
      const events = byUser[uid].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      const last = events[0];
      const lastError =
        events.find((e) => e.status === 'error')?.error_message ||
        events.find((e) => e.step === 'provider_fallback')?.error_message ||
        null;
      const reachedProvider = events.some((e) => e.step === 'payment_initiated');
      const orderId = last.order_id || (last.metadata && last.metadata.orderId) || null;
      const order = orderId ? orders[orderId] : null;
      out.push({
        user_id: uid,
        profile: profiles[uid],
        lastStep: last.step,
        lastStatus: last.status,
        lastError,
        lastEventAt: last.created_at,
        orderId,
        orderTotal: order?.total_usd ?? null,
        orderStatus: order?.status ?? null,
        eventsCount: events.length,
        reachedProvider,
      });
    }
    // Exclude users who actually reached the provider AND have paid orders
    return out
      .filter((d) => d.orderStatus !== 'PAID' && d.orderStatus !== 'SHIPPED')
      .sort((a, b) => new Date(b.lastEventAt).getTime() - new Date(a.lastEventAt).getTime());
  }, [rows, profiles, orders]);

  const summary = useMemo(() => {
    const total = drops.length;
    const stuckAtProvider = drops.filter(
      (d) =>
        d.lastStep === 'provider_failed' ||
        d.lastStep === 'provider_exception' ||
        d.lastStep === 'checkout_failed' ||
        d.lastStep === 'provider_fallback',
    ).length;
    const neverStarted = drops.filter((d) => d.lastStep === 'order_created').length;
    const valueLost = drops.reduce((sum, d) => sum + (d.orderTotal || 0), 0);

    const byError: Record<string, number> = {};
    drops.forEach((d) => {
      const key = d.lastError || STEP_LABEL[d.lastStep] || d.lastStep;
      byError[key] = (byError[key] || 0) + 1;
    });
    const errorBreakdown = Object.entries(byError)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    return { total, stuckAtProvider, neverStarted, valueLost, errorBreakdown };
  }, [drops]);

  const buildWaLink = (phone: string | null, name: string | null, lang: 'fr' | 'en' = 'fr') => {
    if (!phone) return null;
    const cleaned = phone.replace(/[^0-9]/g, '');
    if (!cleaned) return null;
    const greeting =
      lang === 'fr'
        ? `Bonjour ${name || ''}, on a vu que vous avez essayé de finaliser une commande sur AfriShop mais le paiement n'a pas abouti. Voulez-vous qu'on vous aide à terminer ?`
        : `Hi ${name || ''}, we noticed you tried to checkout on AfriShop but the payment didn't go through. Want us to help you complete it?`;
    return `https://wa.me/${cleaned}?text=${encodeURIComponent(greeting)}`;
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Abandoned Checkouts</h1>
          <p className="text-sm text-muted-foreground">
            Real reason each shopper didn't complete payment, based on funnel events.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {WINDOWS.map((w) => (
            <Button
              key={w.label}
              size="sm"
              variant={windowHours === w.hours ? 'default' : 'outline'}
              onClick={() => setWindowHours(w.hours)}
            >
              {w.label}
            </Button>
          ))}
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Abandoned users</div>
          <div className="text-2xl font-bold">{summary.total}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Provider blocked them</div>
          <div className="text-2xl font-bold text-red-500">{summary.stuckAtProvider}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Never started payment</div>
          <div className="text-2xl font-bold">{summary.neverStarted}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Value at risk</div>
          <div className="text-2xl font-bold">${summary.valueLost.toFixed(0)}</div>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
          <h2 className="font-semibold">Top drop reasons</h2>
        </div>
        {summary.errorBreakdown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No data in this window.</p>
        ) : (
          <ul className="space-y-1.5">
            {summary.errorBreakdown.map(([msg, count]) => (
              <li key={msg} className="flex justify-between text-sm">
                <span className="truncate pr-4">{msg}</span>
                <Badge variant="secondary">{count}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h2 className="font-semibold">Users ({drops.length})</h2>
        </div>
        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : drops.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">No abandoned checkouts in this window.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">User</th>
                  <th className="text-left px-3 py-2">Last step reached</th>
                  <th className="text-left px-3 py-2">Reason</th>
                  <th className="text-right px-3 py-2">Order $</th>
                  <th className="text-left px-3 py-2">When</th>
                  <th className="text-right px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {drops.map((d) => {
                  const name = d.profile?.full_name || d.profile?.name || d.profile?.email || d.user_id.slice(0, 8);
                  const wa = buildWaLink(d.profile?.phone || null, d.profile?.name || d.profile?.full_name || null);
                  const isProviderIssue =
                    d.lastStep === 'provider_failed' ||
                    d.lastStep === 'provider_exception' ||
                    d.lastStep === 'checkout_failed' ||
                    d.lastStep === 'provider_fallback';
                  return (
                    <tr key={d.user_id} className="border-t hover:bg-muted/20">
                      <td className="px-3 py-2">
                        <div className="font-medium">{name}</div>
                        <div className="text-xs text-muted-foreground">{d.profile?.phone || '—'}</div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={isProviderIssue ? 'destructive' : 'secondary'}>
                          {STEP_LABEL[d.lastStep] || d.lastStep}
                        </Badge>
                        <div className="text-xs text-muted-foreground mt-0.5">{d.eventsCount} events</div>
                      </td>
                      <td className="px-3 py-2 max-w-xs">
                        <div className="text-xs">{d.lastError || (isProviderIssue ? 'Payment provider did not respond' : 'Closed before paying')}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {d.orderTotal != null ? `$${d.orderTotal.toFixed(0)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {new Date(d.lastEventAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {wa ? (
                          <a href={wa} target="_blank" rel="noreferrer">
                            <Button size="sm" variant="outline">
                              <MessageCircle className="h-3.5 w-3.5 mr-1" />
                              WhatsApp
                            </Button>
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">No phone</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
