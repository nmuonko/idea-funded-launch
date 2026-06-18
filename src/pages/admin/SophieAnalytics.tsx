import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Bot, MessageSquareWarning, Target, TrendingUp } from 'lucide-react';

type Row = {
  created_at: string;
  confidence: number | null;
  needs_escalation: boolean | null;
  escalation_reason: string | null;
  classification: any;
};

type Stats = {
  total: number;
  avgConfidence: number;
  ragHitRate: number;
  escalations: number;
  escalationRate: number;
  byCategory: Record<string, { total: number; escalations: number; avgConfidence: number; ragHits: number }>;
  byReason: Record<string, number>;
  byLang: Record<string, number>;
};

function aggregate(rows: Row[]): Stats {
  const s: Stats = {
    total: rows.length,
    avgConfidence: 0,
    ragHitRate: 0,
    escalations: 0,
    escalationRate: 0,
    byCategory: {},
    byReason: {},
    byLang: {},
  };
  if (!rows.length) return s;
  let confSum = 0, withRag = 0;
  for (const r of rows) {
    const conf = Number(r.confidence ?? 0);
    confSum += conf;
    const cls = (r.classification || {}) as any;
    const cat = String(cls.category || 'UNKNOWN');
    const ragHits = Number(cls.rag_hits ?? 0);
    const lang = String(cls.lang || 'unknown');
    if (ragHits > 0) withRag += 1;
    if (r.needs_escalation) {
      s.escalations += 1;
      const reason = String(r.escalation_reason || 'UNKNOWN');
      s.byReason[reason] = (s.byReason[reason] || 0) + 1;
    }
    if (!s.byCategory[cat]) s.byCategory[cat] = { total: 0, escalations: 0, avgConfidence: 0, ragHits: 0 };
    const b = s.byCategory[cat];
    b.total += 1;
    if (r.needs_escalation) b.escalations += 1;
    b.avgConfidence += conf;
    b.ragHits += ragHits > 0 ? 1 : 0;
    s.byLang[lang] = (s.byLang[lang] || 0) + 1;
  }
  s.avgConfidence = confSum / rows.length;
  s.ragHitRate = withRag / rows.length;
  s.escalationRate = s.escalations / rows.length;
  for (const cat of Object.keys(s.byCategory)) {
    const b = s.byCategory[cat];
    b.avgConfidence = b.avgConfidence / b.total;
  }
  return s;
}

export default function SophieAnalytics() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('chatbot_messages')
        .select('created_at, confidence, needs_escalation, escalation_reason, classification')
        .eq('role', 'assistant')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5000);
      if (error) { console.error(error); setLoading(false); return; }
      setStats(aggregate((data || []) as Row[]));
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[1,2,3,4].map((i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  if (!stats || stats.total === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-2 flex items-center gap-2"><Bot className="h-6 w-6" /> Sophie Analytics</h1>
        <p className="text-muted-foreground">No assistant messages in the last 30 days.</p>
      </div>
    );
  }

  const categories = Object.entries(stats.byCategory).sort((a, b) => b[1].total - a[1].total);
  const reasons = Object.entries(stats.byReason).sort((a, b) => b[1] - a[1]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Bot className="h-6 w-6" /> Sophie Analytics</h1>
          <p className="text-muted-foreground text-sm">Last 30 days · {stats.total.toLocaleString()} assistant messages</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardDescription className="flex items-center gap-1"><Target className="h-3 w-3" /> Avg Confidence</CardDescription></CardHeader>
          <CardContent><div className="text-3xl font-bold">{(stats.avgConfidence * 100).toFixed(0)}%</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription className="flex items-center gap-1"><TrendingUp className="h-3 w-3" /> RAG Hit Rate</CardDescription></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{(stats.ragHitRate * 100).toFixed(0)}%</div>
            <div className="text-xs text-muted-foreground">% of questions where a FAQ matched</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription className="flex items-center gap-1"><MessageSquareWarning className="h-3 w-3" /> WhatsApp Escalations</CardDescription></CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats.escalations}</div>
            <div className="text-xs text-muted-foreground">{(stats.escalationRate * 100).toFixed(1)}% of all messages</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardDescription>Languages</CardDescription></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1">
              {Object.entries(stats.byLang).map(([lng, n]) => (
                <Badge key={lng} variant="secondary">{lng}: {n}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>By Category</CardTitle>
          <CardDescription>Escalation rate and RAG coverage per question category</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground border-b">
                <tr>
                  <th className="py-2">Category</th>
                  <th className="py-2 text-right">Messages</th>
                  <th className="py-2 text-right">Avg Conf.</th>
                  <th className="py-2 text-right">RAG hit %</th>
                  <th className="py-2 text-right">Escalations</th>
                  <th className="py-2 text-right">Esc. rate</th>
                </tr>
              </thead>
              <tbody>
                {categories.map(([cat, b]) => (
                  <tr key={cat} className="border-b last:border-0">
                    <td className="py-2 font-medium">{cat}</td>
                    <td className="py-2 text-right">{b.total}</td>
                    <td className="py-2 text-right">{(b.avgConfidence * 100).toFixed(0)}%</td>
                    <td className="py-2 text-right">{((b.ragHits / b.total) * 100).toFixed(0)}%</td>
                    <td className="py-2 text-right">{b.escalations}</td>
                    <td className="py-2 text-right">
                      <Badge variant={b.escalations / b.total > 0.3 ? 'destructive' : 'secondary'}>
                        {((b.escalations / b.total) * 100).toFixed(0)}%
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Escalation Reasons</CardTitle>
          <CardDescription>What triggered Sophie to hand off to WhatsApp</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {reasons.map(([reason, n]) => (
              <div key={reason} className="flex items-center justify-between">
                <span className="text-sm">{reason}</span>
                <div className="flex items-center gap-2 w-1/2">
                  <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                    <div className="h-full bg-destructive" style={{ width: `${(n / stats.escalations) * 100}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground w-10 text-right">{n}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
