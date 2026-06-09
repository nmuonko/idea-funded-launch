import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, MessageCircle, TrendingDown, Activity, ShoppingCart, CreditCard, Eye } from 'lucide-react';

type Range = '24h' | '7d' | '30d';

function sinceISO(range: Range) {
  const h = range === '24h' ? 24 : range === '7d' ? 24 * 7 : 24 * 30;
  return new Date(Date.now() - h * 3600_000).toISOString();
}

// ----- Top Searches -----
function TopSearches({ range }: { range: Range }) {
  const [rows, setRows] = useState<{ q: string; count: number; zero: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('search_query_log')
        .select('q_norm,db_count,live_count')
        .gte('created_at', sinceISO(range))
        .limit(10000);
      const map = new Map<string, { count: number; zero: number }>();
      (data || []).forEach((r: any) => {
        const q = (r.q_norm || '').trim().toLowerCase();
        if (!q) return;
        const e = map.get(q) || { count: 0, zero: 0 };
        e.count++;
        if ((r.db_count || 0) + (r.live_count || 0) === 0) e.zero++;
        map.set(q, e);
      });
      const arr = Array.from(map.entries())
        .map(([q, v]) => ({ q, ...v }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 50);
      setRows(arr);
      setLoading(false);
    })();
  }, [range]);

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1fr,80px,80px] gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground border-b">
        <div>Recherche</div><div className="text-right">Volume</div><div className="text-right">Sans résultats</div>
      </div>
      {rows.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">Aucune donnée</div>}
      {rows.map((r) => (
        <div key={r.q} className="grid grid-cols-[1fr,80px,80px] gap-2 px-3 py-2 text-sm hover:bg-muted/40 rounded">
          <div className="truncate font-medium">{r.q}</div>
          <div className="text-right font-mono">{r.count}</div>
          <div className="text-right">{r.zero > 0 ? <Badge variant="destructive">{r.zero}</Badge> : <span className="text-muted-foreground">0</span>}</div>
        </div>
      ))}
    </div>
  );
}

// ----- Top Sophie Questions -----
function TopSophieQuestions({ range }: { range: Range }) {
  const [rows, setRows] = useState<{ q: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('chatbot_messages')
        .select('content')
        .eq('role', 'user')
        .gte('created_at', sinceISO(range))
        .limit(5000);
      const map = new Map<string, number>();
      (data || []).forEach((r: any) => {
        const q = (r.content || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
        if (!q || q.length < 2) return;
        map.set(q, (map.get(q) || 0) + 1);
      });
      const arr = Array.from(map.entries())
        .map(([q, count]) => ({ q, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 50);
      setRows(arr);
      setLoading(false);
    })();
  }, [range]);

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1fr,80px] gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground border-b">
        <div>Question posée à Sophie</div><div className="text-right">Fois posée</div>
      </div>
      {rows.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">Aucune question</div>}
      {rows.map((r) => (
        <div key={r.q} className="grid grid-cols-[1fr,80px] gap-2 px-3 py-2 text-sm hover:bg-muted/40 rounded">
          <div className="line-clamp-2">{r.q}</div>
          <div className="text-right font-mono">{r.count}</div>
        </div>
      ))}
    </div>
  );
}

// ----- Checkout Funnel -----
function CheckoutFunnel({ range }: { range: Range }) {
  const [steps, setSteps] = useState<{ step: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('checkout_funnel_log')
        .select('step,session_id')
        .gte('created_at', sinceISO(range))
        .limit(20000);
      // unique sessions per step
      const perStep = new Map<string, Set<string>>();
      (data || []).forEach((r: any) => {
        if (!perStep.has(r.step)) perStep.set(r.step, new Set());
        if (r.session_id) perStep.get(r.step)!.add(r.session_id);
      });
      // Also count paid orders from orders table within range
      const { data: paid } = await supabase
        .from('orders')
        .select('id')
        .eq('status', 'PAID')
        .gte('created_at', sinceISO(range))
        .limit(20000);

      const ordered = [
        { key: 'checkout_started', label: 'Checkout démarré', icon: '🛒' },
        { key: 'order_created', label: 'Commande créée', icon: '📝' },
        { key: 'payment_initiated', label: 'Paiement initié', icon: '💳' },
        { key: 'paid', label: 'Paiement réussi', icon: '✅' },
      ];
      const result = ordered.map(s => ({
        step: s.label,
        count: s.key === 'paid' ? (paid?.length || 0) : (perStep.get(s.key)?.size || 0),
      }));
      setSteps(result);
      setLoading(false);
    })();
  }, [range]);

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>;
  const max = Math.max(...steps.map(s => s.count), 1);
  const first = steps[0]?.count || 0;
  return (
    <div className="space-y-3 p-4">
      {steps.map((s, idx) => {
        const pct = (s.count / max) * 100;
        const conv = first > 0 ? ((s.count / first) * 100).toFixed(1) : '0';
        const dropFromPrev = idx > 0 && steps[idx - 1].count > 0
          ? (((steps[idx - 1].count - s.count) / steps[idx - 1].count) * 100).toFixed(1)
          : null;
        return (
          <div key={s.step}>
            <div className="flex items-center justify-between text-sm mb-1">
              <div className="font-medium">{idx + 1}. {s.step}</div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-lg">{s.count}</span>
                <span className="text-xs text-muted-foreground">{conv}%</span>
                {dropFromPrev && Number(dropFromPrev) > 0 && (
                  <Badge variant="destructive" className="text-[10px]">
                    <TrendingDown className="w-3 h-3 mr-0.5" />-{dropFromPrev}%
                  </Badge>
                )}
              </div>
            </div>
            <div className="h-8 bg-muted rounded-md overflow-hidden">
              <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-md transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
      <div className="mt-6 p-3 bg-muted/50 rounded-md text-xs text-muted-foreground">
        <strong>Astuce :</strong> Le plus gros écart entre deux étapes = là où les utilisateurs abandonnent. Concentrez-vous sur cette étape pour augmenter les conversions.
      </div>
    </div>
  );
}

// ----- User Activity Timeline -----
type Event = { kind: string; label: string; ts: string; meta?: string; icon: any; color: string };

function UserActivityTimeline({ range }: { range: Range }) {
  const [users, setUsers] = useState<{ id: string; label: string; lastSeen: string; events: number }[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      // Get distinct users from funnel logs with recent activity
      const { data } = await supabase
        .from('checkout_funnel_log')
        .select('user_id,session_id,created_at')
        .gte('created_at', sinceISO(range))
        .order('created_at', { ascending: false })
        .limit(2000);
      const map = new Map<string, { lastSeen: string; events: number }>();
      (data || []).forEach((r: any) => {
        const key = r.user_id || `session:${r.session_id}`;
        if (!key) return;
        const e = map.get(key);
        if (!e) map.set(key, { lastSeen: r.created_at, events: 1 });
        else e.events++;
      });
      const arr = Array.from(map.entries())
        .map(([id, v]) => ({ id, label: id.startsWith('session:') ? `Invité ${id.slice(8, 16)}` : `User ${id.slice(0, 8)}`, ...v }))
        .sort((a, b) => +new Date(b.lastSeen) - +new Date(a.lastSeen))
        .slice(0, 100);
      setUsers(arr);
      setLoading(false);
    })();
  }, [range]);

  useEffect(() => {
    if (!selectedUser) return;
    (async () => {
      setLoadingEvents(true);
      const isSession = selectedUser.startsWith('session:');
      const realId = isSession ? selectedUser.slice(8) : selectedUser;
      const since = sinceISO(range);

      // Funnel events
      const funnelQ = supabase
        .from('checkout_funnel_log')
        .select('step,status,error_message,created_at,order_id')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(200);
      const funnelRes = isSession
        ? await funnelQ.eq('session_id', realId)
        : await funnelQ.eq('user_id', realId);

      // Chatbot messages (only if real user)
      let chatRes: any = { data: [] };
      if (!isSession) {
        const { data: convs } = await supabase
          .from('chatbot_conversations')
          .select('id')
          .eq('user_id', realId)
          .limit(50);
        const convIds = (convs || []).map((c: any) => c.id);
        if (convIds.length) {
          chatRes = await supabase
            .from('chatbot_messages')
            .select('role,content,created_at')
            .in('conversation_id', convIds)
            .gte('created_at', since)
            .order('created_at', { ascending: false })
            .limit(100);
        }
      }

      // Orders
      let orderRes: any = { data: [] };
      if (!isSession) {
        orderRes = await supabase
          .from('orders')
          .select('id,status,total_usd,created_at')
          .eq('user_id', realId)
          .gte('created_at', since)
          .order('created_at', { ascending: false })
          .limit(50);
      }

      const all: Event[] = [];
      (funnelRes.data || []).forEach((e: any) => {
        all.push({
          kind: 'funnel',
          label: `Checkout · ${e.step}`,
          ts: e.created_at,
          meta: e.status === 'ok' ? undefined : `${e.status}${e.error_message ? ': ' + e.error_message : ''}`,
          icon: CreditCard,
          color: e.status === 'ok' ? 'text-emerald-500' : 'text-red-500',
        });
      });
      (chatRes.data || []).forEach((m: any) => {
        all.push({
          kind: 'chat',
          label: m.role === 'user' ? `Question à Sophie` : `Réponse Sophie`,
          ts: m.created_at,
          meta: (m.content || '').slice(0, 120),
          icon: MessageCircle,
          color: m.role === 'user' ? 'text-blue-500' : 'text-purple-500',
        });
      });
      (orderRes.data || []).forEach((o: any) => {
        all.push({
          kind: 'order',
          label: `Commande ${o.status}`,
          ts: o.created_at,
          meta: `$${o.total_usd}`,
          icon: ShoppingCart,
          color: o.status === 'paid' ? 'text-emerald-500' : 'text-amber-500',
        });
      });
      all.sort((a, b) => +new Date(b.ts) - +new Date(a.ts));
      setEvents(all);
      setLoadingEvents(false);
    })();
  }, [selectedUser, range]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-[280px,1fr] gap-3 min-h-[500px]">
      <Card className="overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b text-xs font-semibold text-muted-foreground">
          {loading ? 'Chargement…' : `${users.length} utilisateurs actifs`}
        </div>
        <ScrollArea className="flex-1 max-h-[600px]">
          {users.map(u => (
            <button
              key={u.id}
              onClick={() => setSelectedUser(u.id)}
              className={`w-full text-left p-2 border-b text-xs hover:bg-muted/40 ${selectedUser === u.id ? 'bg-muted' : ''}`}
            >
              <div className="font-medium">{u.label}</div>
              <div className="text-muted-foreground">{u.events} évén. · {new Date(u.lastSeen).toLocaleString('fr-FR')}</div>
            </button>
          ))}
        </ScrollArea>
      </Card>
      <Card className="overflow-hidden">
        {!selectedUser ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground p-8">
            Sélectionnez un utilisateur pour voir son parcours
          </div>
        ) : loadingEvents ? (
          <div className="flex justify-center p-8"><Loader2 className="animate-spin" /></div>
        ) : (
          <ScrollArea className="h-[600px] p-4">
            <div className="space-y-3">
              {events.length === 0 && <div className="text-sm text-muted-foreground">Aucun événement</div>}
              {events.map((e, i) => {
                const Icon = e.icon;
                return (
                  <div key={i} className="flex gap-3 items-start">
                    <div className={`mt-0.5 ${e.color}`}><Icon className="w-4 h-4" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{e.label}</div>
                      {e.meta && <div className="text-xs text-muted-foreground truncate">{e.meta}</div>}
                      <div className="text-[10px] text-muted-foreground">{new Date(e.ts).toLocaleString('fr-FR')}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </Card>
    </div>
  );
}

export default function ActivityInsights() {
  const [range, setRange] = useState<Range>('7d');

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6" /> Activity Insights
          </h1>
          <p className="text-sm text-muted-foreground">Comprenez ce que les clients cherchent, demandent, et où ils abandonnent.</p>
        </div>
        <div className="flex gap-1 bg-muted rounded-md p-1">
          {(['24h', '7d', '30d'] as Range[]).map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 text-xs font-medium rounded ${range === r ? 'bg-background shadow' : 'text-muted-foreground'}`}
            >{r}</button>
          ))}
        </div>
      </div>

      <Tabs defaultValue="searches" className="w-full">
        <TabsList className="grid grid-cols-2 md:grid-cols-4 w-full">
          <TabsTrigger value="searches"><Search className="w-4 h-4 mr-2" />Recherches</TabsTrigger>
          <TabsTrigger value="sophie"><MessageCircle className="w-4 h-4 mr-2" />Questions Sophie</TabsTrigger>
          <TabsTrigger value="funnel"><TrendingDown className="w-4 h-4 mr-2" />Funnel</TabsTrigger>
          <TabsTrigger value="timeline"><Eye className="w-4 h-4 mr-2" />Activité</TabsTrigger>
        </TabsList>

        <TabsContent value="searches">
          <Card className="p-3"><TopSearches range={range} /></Card>
        </TabsContent>
        <TabsContent value="sophie">
          <Card className="p-3"><TopSophieQuestions range={range} /></Card>
        </TabsContent>
        <TabsContent value="funnel">
          <Card><CheckoutFunnel range={range} /></Card>
        </TabsContent>
        <TabsContent value="timeline">
          <UserActivityTimeline range={range} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
